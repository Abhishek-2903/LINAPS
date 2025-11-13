'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function PresentPosition() {
  const [position, setPosition] = useState({
    easting: 0,
    northing: 0,
    height: 0,
    zone: 30,
    fixType: 'Waiting...',
    gpsOk: false,
    quality: 'unknown',
  });
  const [imuData, setImuData] = useState({
    pitch: 0,
    roll: 0,
    yaw: 0,
    heading: 0,
  });
  const [lastUpdate, setLastUpdate] = useState('--:--:--');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    document.body.style.background = '#000';
    document.body.style.color = '#fff';
    document.body.style.fontFamily = 'monospace';

    // Connect to WebSocket
    const ws = new WebSocket('ws://localhost:2003');

    ws.onopen = () => {
      setConnected(true);
      console.log('✅ Present Position connected');
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('❌ Present Position disconnected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Update IMU data
        if (data.imu) {
          setImuData({
            pitch: data.imu.pitch || 0,
            roll: data.imu.roll || 0,
            yaw: data.imu.yaw || 0,
            heading: data.imu.heading || 0,
          });
        }

        // Update GNSS data
        if (data.gnss) {
          // Convert lat/lon to UTM (simplified - use proper conversion in production)
          const lat = data.gnss.latitude;
          const lon = data.gnss.longitude;
          const alt = data.gnss.altitude;

          // Simplified UTM conversion (for demo purposes)
          // In production, use a proper library like proj4js
          const easting = Math.round((lon + 180) * 111320 * Math.cos(lat * Math.PI / 180));
          const northing = Math.round((lat + 90) * 111320);

          setPosition({
            easting: easting,
            northing: northing,
            height: Math.round(alt),
            zone: 30,
            fixType: 'INS+GPS',
            gpsOk: true,
            quality: 'good',
          });

          setLastUpdate(new Date().toLocaleTimeString());
        }
      } catch (err) {
        console.error('Parse error:', err);
      }
    };

    return () => {
      ws.close();
      document.body.style.background = '';
      document.body.style.color = '';
    };
  }, []);

  const getColor = (q) =>
    q === 'good'
      ? 'text-green'
      : q === 'warning'
      ? 'text-yellow'
      : 'text-red';

  return (
    <>
      <style jsx>{`
        .screen {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          width: 100vw;
          background-color: #000;
          color: #fff;
          font-family: monospace;
          position: relative;
        }

        .title {
          font-size: 26px;
          font-weight: bold;
          color: #00ff66;
          margin-bottom: 30px;
          letter-spacing: 2px;
          text-transform: uppercase;
        }

        .data-box {
          border: 2px solid #00ff66;
          background: rgba(0, 255, 102, 0.05);
          padding: 40px 50px;
          border-radius: 8px;
          box-shadow: 0 0 30px rgba(0, 255, 102, 0.3);
          width: 500px;
          margin-bottom: 30px;
        }

        .row {
          display: flex;
          justify-content: space-between;
          margin: 12px 0;
          font-size: 18px;
        }

        .label {
          color: #aaa;
          font-weight: bold;
        }

        .value {
          color: #00ff66;
          font-weight: bold;
        }

        .utm {
          text-align: right;
          font-size: 12px;
          color: #888;
          margin-top: 15px;
        }

        .imu-box {
          border: 2px solid #4a9eff;
          background: rgba(74, 158, 255, 0.05);
          padding: 30px 50px;
          border-radius: 8px;
          box-shadow: 0 0 30px rgba(74, 158, 255, 0.3);
          width: 500px;
          margin-bottom: 20px;
        }

        .imu-title {
          font-size: 18px;
          font-weight: bold;
          color: #4a9eff;
          margin-bottom: 15px;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .status {
          margin-top: 20px;
          font-size: 14px;
          color: #bbb;
        }

        .status div {
          margin: 5px 0;
        }

        .green {
          color: #00ff66;
        }

        .yellow {
          color: #ffff66;
        }

        .red {
          color: #ff4444;
        }

        .footer {
          position: absolute;
          bottom: 40px;
          font-size: 12px;
          color: #777;
          font-style: italic;
        }

        .back {
          position: absolute;
          top: 20px;
          left: 20px;
          padding: 12px 20px;
          background: #222;
          border: 1px solid #555;
          color: #fff;
          cursor: pointer;
          border-radius: 5px;
          font-weight: bold;
          transition: all 0.3s;
        }

        .back:hover {
          background: #00ff66;
          color: #000;
          border-color: #00ff66;
        }

        .connection-status {
          position: absolute;
          top: 20px;
          right: 20px;
          padding: 8px 16px;
          border-radius: 5px;
          font-weight: bold;
          font-size: 12px;
        }

        .connected {
          background: #00ff66;
          color: #000;
        }

        .disconnected {
          background: #ff4444;
          color: #fff;
        }
      `}</style>

      <div className="screen">
        <h1 className="title">Present Position</h1>

        {/* Connection Status */}
        <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● CONNECTED' : '● OFFLINE'}
        </div>

        {/* IMU Data Box */}
        <div className="imu-box">
          <div className="imu-title">IMU Orientation</div>
          <div className="row">
            <span className="label">Pitch (Y):</span>
            <span className="value">{imuData.pitch.toFixed(2)}°</span>
          </div>
          <div className="row">
            <span className="label">Roll (X):</span>
            <span className="value">{imuData.roll.toFixed(2)}°</span>
          </div>
          <div className="row">
            <span className="label">Yaw (Z):</span>
            <span className="value">{imuData.yaw.toFixed(2)}°</span>
          </div>
          <div className="row">
            <span className="label">Heading:</span>
            <span className="value">{imuData.heading.toFixed(2)}°</span>
          </div>
        </div>

        {/* GNSS Position Box */}
        <div className="data-box">
          <div className="row">
            <span className="label">Easting =</span>
            <span className="value">{position.easting.toLocaleString()}</span>
          </div>
          <div className="row">
            <span className="label">Northing =</span>
            <span className="value">N {position.northing.toLocaleString()}</span>
          </div>
          <div className="row">
            <span className="label">Height (m) =</span>
            <span className="value">+{position.height}</span>
          </div>
          <div className="row">
            <span className="label">Zone =</span>
            <span className="value">{position.zone}</span>
          </div>
          <div className="utm">UTM (WGS 1984)</div>
        </div>

        {/* Status Section */}
        <div className="status">
          <div>
            Fix: <span className="green">{position.fixType}</span>
          </div>
          <div>
            GPS:{' '}
            <span className={position.gpsOk ? 'green' : 'red'}>
              {position.gpsOk ? 'OK' : 'NO FIX'}
            </span>
          </div>
          <div>
            Quality:{' '}
            <span className={getColor(position.quality)}>
              {position.quality.toUpperCase()}
            </span>
          </div>
          <div>
            Last Update: <span className="yellow">{lastUpdate}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="footer">
          Source: Fused INS+GPS (Inertial Navigation Unit)
        </div>

        {/* Back Button */}
        <Link href="/">
          <button className="back">← Back</button>
        </Link>
      </div>
    </>
  );
}