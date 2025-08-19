import sqlite3
import json
from datetime import datetime
from typing import Dict, Any

def init_db():
    """Initialize database tables"""
    conn = sqlite3.connect('merger_sim.db')
    cursor = conn.cursor()
    
    # Calibration runs table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS calibration_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            seed INTEGER NOT NULL,
            inputs_json TEXT NOT NULL,
            outputs_json TEXT NOT NULL
        )
    ''')
    
    # Scenario runs table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS scenario_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            policy TEXT NOT NULL,
            inputs_json TEXT NOT NULL,
            outputs_json TEXT NOT NULL
        )
    ''')
    
    conn.commit()
    conn.close()

def log_calibration_run(seed: int, inputs: Dict[str, Any], outputs: Dict[str, Any]):
    """Log a calibration run to the database"""
    conn = sqlite3.connect('merger_sim.db')
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO calibration_runs (timestamp, seed, inputs_json, outputs_json)
        VALUES (?, ?, ?, ?)
    ''', (
        datetime.now().isoformat(),
        seed,
        json.dumps(inputs),
        json.dumps(outputs)
    ))
    
    conn.commit()
    conn.close()

def log_scenario_run(policy: str, inputs: Dict[str, Any], outputs: Dict[str, Any]):
    """Log a scenario run to the database"""
    conn = sqlite3.connect('merger_sim.db')
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO scenario_runs (timestamp, policy, inputs_json, outputs_json)
        VALUES (?, ?, ?, ?)
    ''', (
        datetime.now().isoformat(),
        policy,
        json.dumps(inputs),
        json.dumps(outputs)
    ))
    
    conn.commit()
    conn.close()

# Initialize database on import
init_db()
