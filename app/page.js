'use client';

import { useEffect, useState } from 'react';

export default function PostureMonitor() {
  const [pitch, setPitch] = useState(0);
  const [roll, setRoll] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [heading, setHeading] = useState(0);
  const [gnss, setGnss] = useState({ latitude: 0, longitude: 0, altitude: 0 });
  const [connected, setConnected] = useState(false);
  const [target, setTarget] = useState({ pitch: 0, roll: 0, yaw: 0 });
  const [corrections, setCorrections] = useState({ x: 0, y: 0, z: 0 });
  const [ws, setWs] = useState(null);
  const [isAtTarget, setIsAtTarget] = useState(false);

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const getColorClass = (error) => {
    const abs = Math.abs(error);
    if (abs < 0.5) return 'status-good';
    if (abs < 1.5) return 'status-warning';
    return 'status-bad';
  };

  useEffect(() => {
    let socket;
    try {
      socket = new WebSocket('ws://localhost:2003');
      socket.onopen = () => setConnected(true);
      socket.onclose = () => setConnected(false);
      socket.onerror = () => setConnected(false);

      socket.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);

          if (data.imu) {
            // INSTANT UPDATE – NO SMOOTHING
            setPitch(data.imu.pitch);
            setRoll(data.imu.roll);
            setYaw(data.imu.yaw);
            setHeading(data.imu.heading);
          }

          if (data.gnss) {
            setGnss({
              latitude: data.gnss.latitude,
              longitude: data.gnss.longitude,
              altitude: data.gnss.altitude,
            });
          }

          if (data.corrections) {
            setCorrections({
              x: data.corrections.x,
              y: data.corrections.y,
              z: data.corrections.z,
            });
          }

          if (data.target) {
            setTarget({
              pitch: data.target.pitch,
              roll: data.target.roll,
              yaw: data.target.yaw,
            });
          }
        } catch (e) { console.error(e); }
      };

      setWs(socket);
    } catch (err) {
      setConnected(false);
    }

    return () => socket?.close();
  }, []);

  const rollError = roll - target.roll;
  const pitchError = pitch - target.pitch;

  useEffect(() => {
    const at = Math.abs(rollError) < 0.2 && Math.abs(pitchError) < 0.2;
    setIsAtTarget(at);
  }, [rollError, pitchError]);

  const getDynamicScale = (error) => {
    const abs = Math.abs(error);
    if (abs <= 15) return 15;
    if (abs <= 30) return 30;
    if (abs <= 45) return 45;
    if (abs <= 90) return 90;
    return 180;
  };

  const rollScale = getDynamicScale(rollError);
  const pitchScale = getDynamicScale(pitchError);

  const getBarPercentage = (error, scale) => clamp((Math.abs(error) / scale) * 100, 0, 100);

  const xOffset = getBarPercentage(rollError, rollScale);
  const yOffset = getBarPercentage(pitchError, pitchScale);

  const rollDirection = rollError > 0 ? 'RIGHT' : rollError < 0 ? 'LEFT' : 'CENTER';
  const pitchDirection = pitchError > 0 ? 'UP' : pitchError < 0 ? 'DOWN' : 'CENTER';

  const getScaleMarkers = (scale) => {
    const step = scale / 3;
    return [-scale, -scale * 2/3, -scale/3, 0, scale/3, scale * 2/3, scale];
  };

  const saveToFile = () => {
    const txt = `
ARTILLERY POINTING LOG
Time: ${new Date().toLocaleString('en-IN')}

IMU:
  Pitch: ${pitch.toFixed(3)}°
  Roll : ${roll.toFixed(3)}°
  Yaw  : ${yaw.toFixed(3)}°

Target:
  Pitch: ${target.pitch.toFixed(3)}°
  Roll : ${target.roll.toFixed(3)}°

Errors:
  Pitch: ${pitchError.toFixed(3)}°
  Roll : ${rollError.toFixed(3)}°

GNSS:
  Lat: ${gnss.latitude.toFixed(6)}
  Lon: ${gnss.longitude.toFixed(6)}
  Alt: ${gnss.altitude.toFixed(2)} m

Status: ${isAtTarget ? 'ON TARGET' : 'ADJUSTING'}
`;
    const blob = new Blob([txt], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Artillery_${Date.now()}.txt`;
    a.click();
  };

  const handleSet = () => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ command: 'SET' }));
      saveToFile();
      alert('SET confirmed. Position is now 0° reference.');
    } else {
      alert('WebSocket not connected');
    }
  };

  const rollMarkers = getScaleMarkers(rollScale);
  const pitchMarkers = getScaleMarkers(pitchScale);

  return (
    <div className="container">
      <div className="background" />

      {isAtTarget && (
        <div className="on-target-banner">
          ON TARGET – PRESS SET
        </div>
      )}

      <header className="header">
        <div className="title">Artillery Pointing System</div>
        <div className="status-container">
          <span className="status-label">WS:</span>
          <span className={`status-badge ${connected ? 'status-connected' : 'status-disconnected'}`}>
            {connected ? 'ON' : 'OFF'}
          </span>
        </div>
        <button onClick={handleSet} disabled={!connected} className={`set-btn ${connected ? '' : 'disabled'}`}>
          SET
        </button>
      </header>

      <main className="main-content">
        <div className="cards-container">
          <div className="data-card">
            <h1 className="card-title">IMU</h1>
            <div className="data-row">
              <div className="data-item">
                <div className="data-label">Pitch (Y)</div>
                <div className="data-value">{pitch.toFixed(3)}°</div>
                <div className="target-label">Target: {target.pitch.toFixed(3)}°</div>
              </div>
              <div className="divider" />
              <div className="data-item">
                <div className="data-label">Roll (X)</div>
                <div className="data-value">{roll.toFixed(3)}°</div>
                <div className="target-label">Target: {target.roll.toFixed(3)}°</div>
              </div>
              <div className="divider" />
              <div className="data-item">
                <div className="data-label">Yaw (Z)</div>
                <div className="data-value">{yaw.toFixed(3)}°</div>
              </div>
            </div>
          </div>

          <div className="data-card">
            <h1 className="card-title">GNSS</h1>
            <div className="data-row">
              <div className="data-item">
                <div className="data-label">Lat</div>
                <div className="data-value gnss-value">{gnss.latitude.toFixed(6)}</div>
              </div>
              <div className="divider" />
              <div className="data-item">
                <div className="data-label">Lon</div>
                <div className="data-value gnss-value">{gnss.longitude.toFixed(6)}</div>
              </div>
              <div className="divider" />
              <div className="data-item">
                <div className="data-label">Alt</div>
                <div className="data-value gnss-value">{gnss.altitude.toFixed(1)} m</div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Y-AXIS */}
      <aside className="y-axis-container">
        <div className="y-data-column">
          <div className="y-label-side">Y-AXIS (PITCH)</div>
          <div className="y-separator" />
          <span className="label-small">Act: {pitch.toFixed(2)}°</span>
          <span className="label-small">Tgt: {target.pitch.toFixed(2)}°</span>
          <span className={`dir-indicator ${getColorClass(pitchError)}`}>{pitchDirection}</span>
          <span className="scale-tag-inline">±{pitchScale}°</span>
        </div>
        <div className="plus-sign">+</div>
        <div className="bar-vertical-container">
          <div className="degree-marks-left">
            {pitchMarkers.map((deg) => (
              <div key={deg} className="degree-mark" style={{ top: `${50 + (deg / pitchScale) * 50}%` }}>
                {deg.toFixed(0)}°
              </div>
            ))}
          </div>
          <div className="bar-vertical">
            <div className="center-line-v" />
            <div
              className={`bar-fill-v ${getColorClass(pitchError)}`}
              style={{
                height: `${yOffset}%`,
                bottom: pitchError > 0 ? '50%' : 'auto',
                top: pitchError > 0 ? 'auto' : '50%',
              }}
            />
          </div>
        </div>
        <div className="minus-sign">−</div>
      </aside>

      {/* X-AXIS */}
      <div className="x-axis-container">
        <div className="x-data-row">
          <div className="x-data-left">
            <span className="label-small">Actual: {roll.toFixed(2)}°</span>
            <span className="label-small">Target: {target.roll.toFixed(2)}°</span>
          </div>
          <div className="axis-label-center">X-AXIS (ROLL)</div>
          <div className="x-data-right">
            <span className={`dir-indicator ${getColorClass(rollError)}`}>{rollDirection}</span>
            <span className="scale-tag-inline">±{rollScale}°</span>
          </div>
        </div>
        <div className="bar-horizontal-container">
          <div className="bar-horizontal">
            <div className="center-line-h" />
            <div
              className={`bar-fill-h ${getColorClass(rollError)}`}
              style={{
                width: `${xOffset}%`,
                left: rollError > 0 ? '50%' : 'auto',
                right: rollError > 0 ? 'auto' : '50%',
              }}
            />
          </div>
          <div className="degree-marks-bottom">
            {rollMarkers.map((deg) => (
              <div key={deg} className="degree-mark" style={{ left: `${50 - (deg / rollScale) * 50}%` }}>
                {deg.toFixed(0)}°
              </div>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        /* SAME STYLES AS BEFORE – ONLY CHANGE: removed smoothing */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .container { position: relative; width: 100vw; height: 100vh; overflow: hidden; font-family: 'Segoe UI', sans-serif; color: white; }
        .background { position: absolute; inset: 0; background: linear-gradient(135deg, #0a1a3b 0%, #1e2a5e 50%, #0a1a3b 100%); z-index: 0; }
        .header { position: fixed; top: 0; left: 0; right: 0; padding: 18px 50px; background: rgba(0,0,0,0.6); backdrop-filter: blur(15px); border-bottom: 2px solid rgba(251,191,36,0.4); z-index: 1000; display: flex; align-items: center; justify-content: center; gap: 2rem; }
        .title { font-size: 26px; font-weight: 700; color: #fbbf24; text-shadow: 0 0 15px rgba(251,191,36,0.6); }
        .status-container { display: flex; align-items: center; gap: 8px; }
        .status-label { color: #94a3b8; font-size: 13px; }
        .status-badge { padding: 4px 10px; border-radius: 12px; font-weight: 600; font-size: 12px; }
        .status-connected { background: rgba(34,197,94,0.2); color: #22c55e; border: 1px solid #22c55e; }
        .status-disconnected { background: rgba(248,113,113,0.2); color: #f87171; border: 1px solid #f87171; }
        .set-btn { background: #fbbf24; color: #000; font-weight: 700; border: none; border-radius: 50px; padding: 8px 24px; cursor: pointer; font-size: 14px; box-shadow: 0 0 20px rgba(251,191,36,0.5); transition: all 0.3s; }
        .set-btn:hover { background: #facc15; transform: scale(1.05); }
        .set-btn.disabled { background: #6b7280; color: #9ca3af; cursor: not-allowed; box-shadow: none; }
        .on-target-banner { position: fixed; top: 85px; left: 50%; transform: translateX(-50%); background: linear-gradient(90deg, #22c55e, #16a34a); color: #000; font-weight: 900; padding: 12px 35px; border-radius: 50px; font-size: 18px; z-index: 999; box-shadow: 0 0 50px rgba(34,197,94,1); animation: pulse-banner 1.5s infinite; }
        @keyframes pulse-banner { 0%, 100% { opacity: 1; transform: translateX(-50%) scale(1); } 50% { opacity: 0.9; transform: translateX(-50%) scale(1.05); } }
        .main-content { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10; }
        .cards-container { display: flex; flex-direction: column; gap: 18px; align-items: center; }
        .data-card { background: rgba(255,255,255,0.08); backdrop-filter: blur(20px); border: 2px solid rgba(251,191,36,0.4); border-radius: 18px; padding: 22px 35px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); min-width: 600px; }
        .card-title { font-size: 16px; font-weight: 700; color: #fbbf24; text-align: center; margin-bottom: 12px; }
        .data-row { display: flex; justify-content: center; align-items: center; gap: 28px; }
        .data-item { text-align: center; }
        .data-label { font-size: 11px; color: #94a3b8; margin-bottom: 4px; }
        .data-value { font-size: 30px; font-weight: 700; color: #fbbf24; text-shadow: 0 0 10px rgba(251,191,36,0.5); }
        .gnss-value { font-size: 22px; }
        .target-label { font-size: 10px; color: #cbd5e1; margin-top: 2px; }
        .divider { width: 2px; height: 45px; background: linear-gradient(to bottom, transparent, rgba(251,191,36,0.5), transparent); }
        .y-axis-container { position: fixed; right: 15px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 100; }
        .y-data-column { display: flex; flex-direction: column; align-items: center; gap: 6px; background: rgba(0,0,0,0.6); padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(251,191,36,0.3); min-width: 130px; }
        .y-label-side { font-size: 11px; font-weight: 700; color: #fbbf24; letter-spacing: 1.5px; text-shadow: 0 0 10px rgba(251,191,36,0.6); text-align: center; }
        .y-separator { width: 80%; height: 1px; background: rgba(251,191,36,0.3); margin: 2px 0; }
        .plus-sign, .minus-sign { font-size: 22px; font-weight: 700; color: #fbbf24; text-shadow: 0 0 15px rgba(251,191,36,0.8); }
        .bar-vertical-container { display: flex; align-items: center; gap: 10px; height: 450px; }
        .degree-marks-left { display: flex; flex-direction: column; position: relative; height: 100%; }
        .degree-mark { position: absolute; font-size: 10px; color: #cbd5e1; font-family: monospace; transform: translateY(-50%); white-space: nowrap; }
        .bar-vertical { position: relative; width: 70px; height: 100%; background: rgba(0,0,0,0.7); border: 3px solid rgba(251,191,36,0.5); border-radius: 35px; box-shadow: inset 0 4px 20px rgba(0,0,0,0.8); overflow: hidden; }
        .center-line-v { position: absolute; top: 50%; left: 0; right: 0; height: 3px; background: linear-gradient(to right, transparent, #fbbf24, #facc15, #fbbf24, transparent); transform: translateY(-50%); box-shadow: 0 0 18px rgba(251,191,36,1); z-index: 10; }
        .bar-fill-v { position: absolute; left: 0; right: 0; border-radius: 35px; transition: height 0.4s ease, top 0.4s ease; }
        .x-axis-container { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 100; width: 88%; max-width: 850px; }
        .x-data-row { display: flex; justify-content: space-between; align-items: center; width: 100%; background: rgba(0,0,0,0.6); padding: 8px 20px; border-radius: 12px; border: 1px solid rgba(251,191,36,0.3); }
        .x-data-left, .x-data-right { display: flex; gap: 15px; align-items: center; }
        .label-small { font-size: 11px; color: #cbd5e1; font-family: monospace; }
        .axis-label-center { font-size: 11px; font-weight: 700; color: #fbbf24; letter-spacing: 1.8px; text-shadow: 0 0 10px rgba(251,191,36,0.6); }
        .dir-indicator { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 8px; }
        .scale-tag-inline { font-size: 10px; color: #94a3b8; background: rgba(0,0,0,0.5); padding: 3px 8px; border-radius: 6px; }
        .bar-horizontal-container { width: 100%; display: flex; flex-direction: column; gap: 8px; }
        .bar-horizontal { position: relative; width: 100%; height: 65px; background: rgba(0,0,0,0.7); border: 3px solid rgba(251,191,36,0.5); border-radius: 35px; box-shadow: inset 0 4px 20px rgba(0,0,0,0.8); overflow: hidden; }
        .center-line-h { position: absolute; left: 50%; top: 0; bottom: 0; width: 3px; background: linear-gradient(to bottom, transparent, #fbbf24, #facc15, #fbbf24, transparent); transform: translateX(-50%); box-shadow: 0 0 18px rgba(251,191,36,1); z-index: 10; }
        .bar-fill-h { position: absolute; top: 0; bottom: 0; border-radius: 35px; transition: width 0.4s ease, left 0.4s ease; }
        .degree-marks-bottom { display: flex; position: relative; width: 100%; justify-content: space-between; }
        .degree-marks-bottom .degree-mark { position: absolute; transform: translateX(-50%); font-size: 10px; color: #cbd5e1; font-family: monospace; }
        .status-good { background: linear-gradient(180deg, #22c55e, #16a34a); box-shadow: 0 0 35px rgba(34,197,94,0.9); color: #000; }
        .status-warning { background: linear-gradient(180deg, #fbbf24, #f59e0b); box-shadow: 0 0 35px rgba(251,191,36,0.9); color: #000; }
        .status-bad { background: linear-gradient(180deg, #f87171, #dc2626); box-shadow: 0 0 35px rgba(248,113,113,0.9); color: #000; }
        @media (max-width: 1024px) { .data-card { min-width: 520px; padding: 18px 28px; } .bar-vertical-container { height: 400px; } .bar-vertical { width: 60px; } }
        @media (max-width: 768px) { .data-card { min-width: 90vw; padding: 16px 22px; } .data-value { font-size: 24px; } .gnss-value { font-size: 18px; } .bar-vertical-container { height: 350px; } .bar-vertical { width: 55px; } .bar-horizontal { height: 55px; } .x-axis-container { width: 95%; } .x-data-row { padding: 6px 15px; } .label-small { font-size: 10px; } }
      `}</style>
    </div>
  );
}
