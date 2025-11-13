#!/usr/bin/env python3
import asyncio
import json
import websockets
from datetime import datetime, UTC
import serial
import threading
import time
import re
import math
import board
import busio
import sys

# Adafruit BNO08x
from adafruit_bno08x.i2c import BNO08X_I2C
from adafruit_bno08x import BNO_REPORT_ROTATION_VECTOR

# ----------------------------------------------------------------------
# CONFIG
# ----------------------------------------------------------------------
HOST = "0.0.0.0"
PORT = 2003
XBEE_PORT = "/dev/ttyUSB0"
XBEE_BAUD = 9600

# ----------------------------------------------------------------------
# QUATERNION → EULER
# ----------------------------------------------------------------------
def quaternion_to_euler(w, x, y, z):
    norm = math.sqrt(w*w + x*x + y*y + z*z)
    if norm == 0 or math.isnan(norm):
        return None
    w /= norm; x /= norm; y /= norm; z /= norm

    t0 = 2.0 * (w * x + y * z)
    t1 = 1.0 - 2.0 * (x*x + y*y)
    roll = math.atan2(t0, t1)

    t2 = 2.0 * (w * y - z * x)
    t2 = max(min(t2, 1.0), -1.0)
    pitch = math.asin(t2)

    t3 = 2.0 * (w * z + x * y)
    t4 = 1.0 - 2.0 * (y*y + z*z)
    yaw = math.atan2(t3, t4)

    return roll, pitch, yaw

# ----------------------------------------------------------------------
# GLOBAL STATE
# ----------------------------------------------------------------------
class SystemState:
    def __init__(self):
        self.raw_pitch = 0.0
        self.raw_roll  = 0.0
        self.raw_yaw   = 0.0
        self.heading   = 280.0

        self.latitude  = 28.6139
        self.longitude = 77.2090
        self.altitude  = 250.0

        self.correction_x = 0.0
        self.correction_y = 0.0
        self.correction_z = 0.0

        self.gun_id = 1

        self.zero_pitch = 0.0
        self.zero_roll  = 0.0
        self.zero_yaw   = 0.0

        self.lock = threading.Lock()

state = SystemState()
ser = None
bno = None

# ----------------------------------------------------------------------
# REAL BNO085 READER (NO SIMULATION)
# ----------------------------------------------------------------------
def read_imu_data():
    global bno
    try:
        i2c = busio.I2C(board.SCL, board.SDA)
        bno = BNO08X_I2C(i2c)
        bno.enable_feature(BNO_REPORT_ROTATION_VECTOR)
        print("BNO085 initialized – using REAL IMU data")
    except Exception as e:
        print(f"BNO085 FAILED: {e}")
        print("Connect BNO085 via I2C and restart.")
        sys.exit(1)  # CRASH – no fallback

    while True:
        try:
            q = bno.quaternion
            if not q or len(q) != 4:
                time.sleep(0.01)
                continue

            w, x, y, z = q
            euler = quaternion_to_euler(w, x, y, z)
            if not euler:
                time.sleep(0.01)
                continue

            roll, pitch, yaw = euler
            with state.lock:
                state.raw_roll  = math.degrees(roll)
                state.raw_pitch = math.degrees(pitch)
                state.raw_yaw   = math.degrees(yaw)
                state.heading = 280.0
            time.sleep(0.01)
        except Exception as e:
            print(f"IMU read error: {e}")
            time.sleep(0.1)

# ----------------------------------------------------------------------
# SIMULATED GNSS
# ----------------------------------------------------------------------
def read_gnss_data():
    while True:
        with state.lock:
            state.latitude  += random.uniform(-0.000008, 0.000008)
            state.longitude += random.uniform(-0.000008, 0.000008)
            state.altitude  += random.uniform(-0.08, 0.08)
        time.sleep(1.0)

# ----------------------------------------------------------------------
# ZIGBEE (CORRECTIONS)
# ----------------------------------------------------------------------
def open_zigbee():
    global ser
    ports = [XBEE_PORT, "/dev/ttyUSB1", "/dev/ttyACM0"]
    for p in ports:
        if not os.path.exists(p): continue
        try:
            ser = serial.Serial(p, XBEE_BAUD, timeout=1)
            print(f"ZigBee on {p}")
            return True
        except: pass
    print("No ZigBee found")
    return False

def read_zigbee_corrections():
    if not open_zigbee(): return
    pattern = re.compile(r'(?P<gun_id>\d+) (?P<x>[\d\.\-]+) (?P<y>[\d\.\-]+) (?P<z>[\d\.\-]+)')
    last_send = 0
    while True:
        now = time.time()
        if now - last_send >= 1.0:
            msg = f"{state.gun_id} {state.heading}\n"
            try:
                ser.write(msg.encode())
                print(f"Sent: {msg.strip()}")
                last_send = now
            except: pass

        try:
            if ser.in_waiting:
                line = ser.readline().decode(errors='ignore').strip()
                if not line: continue
                print(f"Recv: {line}")
                m = pattern.fullmatch(line)
                if m and int(m.group('gun_id')) == 1:
                    with state.lock:
                        state.correction_x = float(m.group('x'))
                        state.correction_y = float(m.group('y'))
                        state.correction_z = float(m.group('z'))
        except: pass
        time.sleep(0.05)

# ----------------------------------------------------------------------
# WEBSOCKET SERVER
# ----------------------------------------------------------------------
async def handle_client(ws):
    print(f"Client connected: {ws.remote_address}")
    async def recv_cmd():
        try:
            async for msg in ws:
                cmd = json.loads(msg)
                if cmd.get('command') == 'SET':
                    with state.lock:
                        state.zero_pitch = state.raw_pitch
                        state.zero_roll  = state.raw_roll
                        state.zero_yaw   = state.raw_yaw
                        state.correction_x = state.correction_y = state.correction_z = 0.0
                    print("SET: Zero reference updated, corrections reset")
        except: pass

    asyncio.create_task(recv_cmd())

    while True:
        with state.lock:
            rel_pitch = (state.raw_pitch - state.zero_pitch) + state.correction_y
            rel_roll  = (state.raw_roll  - state.zero_roll)  + state.correction_x
            rel_yaw   = (state.raw_yaw   - state.zero_yaw)   + state.correction_z

            payload = {
                "timestamp": datetime.now(UTC).isoformat() + "Z",
                "gun_id": state.gun_id,
                "imu": {
                    "pitch": round(rel_pitch, 3),
                    "roll":  round(rel_roll,  3),
                    "yaw":   round(rel_yaw,   3),
                    "heading": round(state.heading, 1)
                },
                "gnss": {
                    "latitude":  round(state.latitude, 6),
                    "longitude": round(state.longitude, 6),
                    "altitude":  round(state.altitude, 1)
                },
                "corrections": {
                    "x": round(state.correction_x, 3),
                    "y": round(state.correction_y, 3),
                    "z": round(state.correction_z, 3)
                },
                "target": {
                    "pitch": round(state.correction_y, 3),
                    "roll":  round(state.correction_x, 3),
                    "yaw":   round(state.correction_z, 3)
                }
            }
        await ws.send(json.dumps(payload))
        await asyncio.sleep(1.0)

# ----------------------------------------------------------------------
# MAIN
# ----------------------------------------------------------------------
async def main():
    print("Artillery System – REAL BNO085 ONLY")
    threading.Thread(target=read_imu_data, daemon=True).start()
    threading.Thread(target=read_gnss_data, daemon=True).start()
    threading.Thread(target=read_zigbee_corrections, daemon=True).start()

    async with websockets.serve(handle_client, HOST, PORT):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nStopped")
    finally:
        if ser and ser.is_open:
            ser.close()
