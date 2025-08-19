#!/bin/bash

echo "🚀 Deploying CDS Merger Simulation Dashboard..."

# Install dependencies
echo "📦 Installing dependencies..."
pip install -r requirements.txt

# Run simulation to generate data
echo "🔢 Running simulation..."
python main.py

# Start Streamlit application
echo "🌐 Starting Streamlit application..."
echo "📊 Dashboard will be available at: http://localhost:8501"
echo "🌍 For external access: http://$(hostname -I | awk '{print $1}'):8501"

streamlit run app.py --server.port 8501 --server.address 0.0.0.0
