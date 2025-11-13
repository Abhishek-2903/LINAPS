#!/usr/bin/env python3
"""
Artillery Pointing System - BNO085 I2C Server for Raspberry Pi 5
Real sensor data only, no simulation
WebSocket sends: {imu: {pitch, roll, yaw, heading}, gnss: {lat, lon, alt}, target: {pitch, roll, yaw}, corrections: {x, y, z}}
"""

import asyncio
import websockets
import json
import logging
import board
import busio
from adafruit_bno08x import BNO_REPORT_ROTATION_VECTOR
from adafruit_bno08x.i2c import BNO08X_I2C
import serial
import serial.tools.list_ports
import math
from collections import deque
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class BNO085Sensor:
    """Handle BNO085 IMU sensor via I2C"""
    
    def __init__(self):
        self.bno = None
        self.offset_pitch = 0.0
        self.offset_roll = 0.0
        self.offset_yaw = 0.0
        self.initialized = False
        
        # Moving average filters
        self.pitch_buffer = deque(maxlen=5)
        self.roll_buffer = deque(maxlen=5)
        self.yaw_buffer = deque(maxlen=5)
        
        # Current values
        self.current_pitch = 0.0
        self.current_roll = 0.0
        self.current_yaw = 0.0
        self.current_heading = 0.0
        
    def initialize(self):
        """Initialize I2C connection to BNO085"""
        try:
            logger.info("Initializing I2C for BNO085...")
            i2c = busio.I2C(board.SCL, board.SDA, frequency=400000)
            
            logger.info("Creating BNO08X object...")
            # Try default address 0x4A first, then 0x4B
            try:
                self.bno = BNO08X_I2C(i2c, address=0x4A)
                logger.info("BNO085 found at address 0x4A")
            except:
                self.bno = BNO08X_I2C(i2c, address=0x4B)
                logger.info("BNO085 found at address 0x4B")
            
            logger.info("Enabling rotation vector reports...")
            self.bno.enable_feature(BNO_REPORT_ROTATION_VECTOR)
            
            # Wait for sensor to stabilize
            time.sleep(0.5)
            
            self.initialized = True
            logger.info("✓ BNO085 initialized successfully on I2C")
            return True
            
        except Exception as e:
            logger.error(f"✗ Failed to initialize BNO085: {e}")
            logger.error("Check connections:")
            logger.error("  BNO085 VIN  → Pi Pin 1  (3.3V)")
            logger.error("  BNO085 GND  → Pi Pin 6  (GND)")
            logger.error("  BNO085 SDA  → Pi Pin 3  (GPIO 2)")
            logger.error("  BNO085 SCL  → Pi Pin 5  (GPIO 3)")
            logger.error("Run: sudo i2cdetect -y 1")
            return False
    
    def quaternion_to_euler(self, qw, qx, qy, qz):
        """
        Convert quaternion to Euler angles (roll, pitch, yaw) in degrees
        Returns: (roll, pitch, yaw) all in degrees
        """
        
        # Roll (x-axis rotation) - side to side tilt
        sinr_cosp = 2 * (qw * qx + qy * qz)
        cosr_cosp = 1 - 2 * (qx * qx + qy * qy)
        roll = math.atan2(sinr_cosp, cosr_cosp)
        
        # Pitch (y-axis rotation) - forward/backward tilt
        sinp = 2 * (qw * qy - qz * qx)
        if abs(sinp) >= 1:
            pitch = math.copysign(math.pi / 2, sinp)
        else:
            pitch = math.asin(sinp)
        
        # Yaw (z-axis rotation) - compass direction
        siny_cosp = 2 * (qw * qz + qx * qy)
        cosy_cosp = 1 - 2 * (qy * qy + qz * qz)
        yaw = math.atan2(siny_cosp, cosy_cosp)
        
        # Convert radians to degrees
        roll = math.degrees(roll)
        pitch = math.degrees(pitch)
        yaw = math.degrees(yaw)
        
        return roll, pitch, yaw
    
    def apply_smoothing(self, roll, pitch, yaw):
        """Apply moving average filter to reduce noise"""
        self.roll_buffer.append(roll)
        self.pitch_buffer.append(pitch)
        self.yaw_buffer.append(yaw)
        
        avg_roll = sum(self.roll_buffer) / len(self.roll_buffer)
        avg_pitch = sum(self.pitch_buffer) / len(self.pitch_buffer)
        avg_yaw = sum(self.yaw_buffer) / len(self.yaw_buffer)
        
        return avg_roll, avg_pitch, avg_yaw
    
    def normalize_angle(self, angle):
        """Normalize angle to -180 to 180 degrees"""
        while angle > 180:
            angle -= 360
        while angle < -180:
            angle += 360
        return angle
    
    def read_orientation(self):
        """
        Read orientation from BNO085
        Returns dict with: pitch, roll, yaw, heading (all in degrees)
        """
        if not self.initialized or not self.bno:
            return {
                'pitch': self.current_pitch,
                'roll': self.current_roll,
                'yaw': self.current_yaw,
                'heading': self.current_heading
            }
        
        try:
            # Get quaternion from rotation vector
            quat_i, quat_j, quat_k, quat_real = self.bno.quaternion
            
            # Check if valid data received
            if quat_real is None:
                return {
                    'pitch': self.current_pitch,
                    'roll': self.current_roll,
                    'yaw': self.current_yaw,
                    'heading': self.current_heading
                }
            
            # Convert quaternion to euler angles
            roll, pitch, yaw = self.quaternion_to_euler(
                quat_real, quat_i, quat_j, quat_k
            )
            
            # Apply smoothing filter
            roll, pitch, yaw = self.apply_smoothing(roll, pitch, yaw)
            
            # Apply offsets from SET command
            roll -= self.offset_roll
            pitch -= self.offset_pitch
            yaw -= self.offset_yaw
            
            # Normalize to -180 to 180 range
            roll = self.normalize_angle(roll)
            pitch = self.normalize_angle(pitch)
            yaw = self.normalize_angle(yaw)
            
            # Calculate heading (0-360 degrees, North=0)
            heading = (yaw + 360) % 360
            
            # Store current values
            self.current_pitch = round(pitch, 3)
            self.current_roll = round(roll, 3)
            self.current_yaw = round(yaw, 3)
            self.current_heading = round(heading, 3)
            
            return {
                'pitch': self.current_pitch,
                'roll': self.current_roll,
                'yaw': self.current_yaw,
                'heading': self.current_heading
            }
            
        except Exception as e:
            logger.error(f"Error reading BNO085: {e}")
            return {
                'pitch': self.current_pitch,
                'roll': self.current_roll,
                'yaw': self.current_yaw,
                'heading': self.current_heading
            }
    
    def set_zero(self):
        """
        Set current position as zero reference point
        All future readings will be relative to this position
        """
        try:
            # Read current orientation
            quat_i, quat_j, quat_k, quat_real = self.bno.quaternion
            
            if quat_real is not None:
                roll, pitch, yaw = self.quaternion_to_euler(
                    quat_real, quat_i, quat_j, quat_k
                )
                
                # Apply smoothing
                roll, pitch, yaw = self.apply_smoothing(roll, pitch, yaw)
                
                # Set current position as new zero
                self.offset_roll = roll
                self.offset_pitch = pitch
                self.offset_yaw = yaw
                
                # Reset current values to zero
                self.current_pitch = 0.0
                self.current_roll = 0.0
                self.current_yaw = 0.0
                self.current_heading = 0.0
                
                logger.info(f"✓ ZERO SET: Roll={roll:.2f}°, Pitch={pitch:.2f}°, Yaw={yaw:.2f}°")
                logger.info("All IMU values reset to 0° reference")
                return True
                
        except Exception as e:
            logger.error(f"Error setting zero: {e}")
        
        return False


class GNSSReader:
    """Handle GNSS data from USB serial port"""
    
    def __init__(self):
        self.serial = None
        self.port = None
        self.last_data = {'latitude': 0.0, 'longitude': 0.0, 'altitude': 0.0}
        
    def find_gnss_port(self):
        """Auto-detect GNSS USB port"""
        ports = serial.tools.list_ports.comports()
        for port in ports:
            if 'USB' in port.device or 'ACM' in port.device:
                return port.device
        return None
        
    def initialize(self):
        """Initialize serial connection to GNSS"""
        try:
            # Auto-detect port
            self.port = self.find_gnss_port()
            
            if not self.port:
                logger.warning("✗ No GNSS device found on USB ports")
                logger.info("GNSS data will remain at 0,0,0")
                return False
            
            logger.info(f"Found GNSS device on {self.port}")
            
            # Try common baud rates
            for baudrate in [9600, 115200, 4800, 38400]:
                try:
                    self.serial = serial.Serial(
                        port=self.port,
                        baudrate=baudrate,
                        timeout=1
                    )
                    logger.info(f"✓ GNSS connected at {baudrate} baud")
                    return True
                except:
                    continue
                    
            logger.warning("✗ Could not connect to GNSS")
            return False
            
        except Exception as e:
            logger.warning(f"✗ GNSS initialization error: {e}")
            return False
    
    def parse_nmea(self, line):
        """Parse NMEA sentence for GPS data"""
        try:
            if line.startswith('$GPGGA') or line.startswith('$GNGGA'):
                parts = line.split(',')
                if len(parts) >= 10:
                    # Latitude
                    if parts[2] and parts[3]:
                        lat_deg = float(parts[2][:2])
                        lat_min = float(parts[2][2:])
                        lat = lat_deg + (lat_min / 60.0)
                        if parts[3] == 'S':
                            lat = -lat
                        self.last_data['latitude'] = round(lat, 6)
                    
                    # Longitude
                    if parts[4] and parts[5]:
                        lon_deg = float(parts[4][:3])
                        lon_min = float(parts[4][3:])
                        lon = lon_deg + (lon_min / 60.0)
                        if parts[5] == 'W':
                            lon = -lon
                        self.last_data['longitude'] = round(lon, 6)
                    
                    # Altitude
                    if parts[9]:
                        self.last_data['altitude'] = round(float(parts[9]), 2)
                    
                    return True
                    
        except Exception as e:
            pass
        
        return False
    
    def read_gnss(self):
        """Read GNSS data from serial port"""
        if not self.serial or not self.serial.is_open:
            return self.last_data
        
        try:
            if self.serial.in_waiting > 0:
                line = self.serial.readline().decode('ascii', errors='ignore').strip()
                self.parse_nmea(line)
        except Exception as e:
            pass
        
        return self.last_data


class WebSocketServer:
    """
    WebSocket server for Artillery Pointing System
    
    WEBSOCKET DATA FORMAT (sent to client every 50ms):
    {
        "imu": {
            "pitch": 1.234,     // Y-axis tilt in degrees
            "roll": -0.567,     // X-axis tilt in degrees
            "yaw": 45.678,      // Z-axis rotation in degrees
            "heading": 45.678   // Compass heading 0-360 degrees
        },
        "gnss": {
            "latitude": 28.123456,   // Decimal degrees
            "longitude": 77.123456,  // Decimal degrees
            "altitude": 250.5        // Meters above sea level
        },
        "target": {
            "pitch": 0.0,       // Target pitch (0 after SET)
            "roll": 0.0,        // Target roll (0 after SET)
            "yaw": 0.0          // Target yaw (0 after SET)
        },
        "corrections": {
            "x": -0.567,        // Roll error (current - target)
            "y": 1.234,         // Pitch error (current - target)
            "z": 45.678         // Yaw error (current - target)
        }
    }
    
    RECEIVED COMMANDS FROM CLIENT:
    {"command": "SET"}  // Sets current position as zero reference
    """
    
    def __init__(self, host='0.0.0.0', port=2003):
        self.host = host
        self.port = port
        self.clients = set()
        self.bno = BNO085Sensor()
        self.gnss = GNSSReader()
        self.target = {'pitch': 0.0, 'roll': 0.0, 'yaw': 0.0}
        self.running = True
        
    async def initialize(self):
        """Initialize sensors"""
        logger.info("=" * 50)
        logger.info("    ARTILLERY POINTING SYSTEM")
        logger.info("    Real BNO085 I2C Data Only")
        logger.info("=" * 50)
        logger.info("Initializing sensors...")
        
        # Initialize BNO085 (REQUIRED)
        if not self.bno.initialize():
            logger.error("❌ BNO085 initialization failed. Cannot continue.")
            logger.error("System requires BNO085 IMU sensor.")
            return False
        
        # Initialize GNSS (OPTIONAL)
        self.gnss.initialize()
        
        logger.info("=" * 50)
        logger.info("✓ System Ready - Waiting for connections...")
        logger.info("=" * 50)
        return True
    
    async def handle_client(self, websocket, path):
        """Handle WebSocket client connection"""
        self.clients.add(websocket)
        client_addr = websocket.remote_address
        logger.info(f"✓ Client connected: {client_addr}")
        
        try:
            # Listen for commands from client
            async for message in websocket:
                await self.handle_message(message, websocket)
                
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"✗ Client disconnected: {client_addr}")
        except Exception as e:
            logger.error(f"Client handler error: {e}")
        finally:
            self.clients.discard(websocket)
    
    async def handle_message(self, message, websocket):
        """
        Handle incoming commands from client
        Expected format: {"command": "SET"}
        """
        try:
            data = json.loads(message)
            command = data.get('command', '').upper()
            
            if command == 'SET':
                logger.info("📍 SET command received")
                
                # Set current position as zero reference
                if self.bno.set_zero():
                    # Reset target to zero
                    self.target = {
                        'pitch': 0.0,
                        'roll': 0.0,
                        'yaw': 0.0
                    }
                    
                    response = {
                        'status': 'success',
                        'message': 'Zero reference set - IMU values reset to 0°',
                        'target': self.target
                    }
                    logger.info("✓ SET successful - Zero reference established")
                else:
                    response = {
                        'status': 'error',
                        'message': 'Failed to set zero reference'
                    }
                    logger.error("✗ SET failed")
                
                await websocket.send(json.dumps(response))
            
            else:
                logger.warning(f"Unknown command: {command}")
                
        except json.JSONDecodeError:
            logger.error("Invalid JSON received from client")
        except Exception as e:
            logger.error(f"Error handling message: {e}")
    
    async def send_update(self, websocket):
        """
        Send complete sensor data update to client
        Format: {imu: {...}, gnss: {...}, target: {...}, corrections: {...}}
        """
        try:
            # Read IMU data from BNO085
            imu_data = self.bno.read_orientation()
            
            # Read GNSS data
            gnss_data = self.gnss.read_gnss()
            
            # Calculate corrections (error from target)
            corrections = {
                'x': round(imu_data['roll'] - self.target['roll'], 3),
                'y': round(imu_data['pitch'] - self.target['pitch'], 3),
                'z': round(imu_data['yaw'] - self.target['yaw'], 3)
            }
            
            # Prepare complete message
            message = {
                'imu': imu_data,
                'gnss': gnss_data,
                'target': self.target,
                'corrections': corrections
            }
            
            # Send to client
            await websocket.send(json.dumps(message))
            
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            logger.error(f"Error sending update: {e}")
    
    async def broadcast_loop(self):
        """
        Continuously broadcast sensor data to all connected clients
        Update rate: 20 Hz (every 50ms)
        """
        logger.info("🔄 Broadcast loop started (20 Hz)")
        
        while self.running:
            if self.clients:
                # Send to all connected clients
                disconnected = set()
                
                for client in self.clients:
                    try:
                        await self.send_update(client)
                    except:
                        disconnected.add(client)
                
                # Remove disconnected clients
                self.clients -= disconnected
            
            await asyncio.sleep(0.05)  # 20 Hz = 50ms interval
    
    async def start(self):
        """Start WebSocket server"""
        if not await self.initialize():
            logger.error("❌ Initialization failed. Exiting.")
            return
        
        logger.info(f"🌐 Starting WebSocket server...")
        logger.info(f"   Host: {self.host}")
        logger.info(f"   Port: {self.port}")
        logger.info(f"   URL:  ws://{self.host}:{self.port}")
        
        try:
            async with websockets.serve(self.handle_client, self.host, self.port):
                logger.info("✓ Server is running")
                logger.info("📡 Broadcasting IMU data at 20 Hz")
                logger.info("Press Ctrl+C to stop")
                await self.broadcast_loop()
        except Exception as e:
            logger.error(f"Server error: {e}")
        finally:
            self.running = False


async def main():
    """Main entry point"""
    server = WebSocketServer(host='0.0.0.0', port=2003)
    await server.start()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n" + "=" * 50)
        logger.info("   Server stopped by user (Ctrl+C)")
        logger.info("=" * 50)
    except Exception as e:
        logger.error(f"❌ Fatal error: {e}")
