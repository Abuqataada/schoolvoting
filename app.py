# app.py
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_file
from flask_session import Session
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import datetime
import json
from werkzeug.utils import secure_filename
import cv2
import numpy as np
import face_recognition
import base64
from io import BytesIO
from pathlib import Path
import logging
from logging.handlers import RotatingFileHandler

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'your-secret-key-change-in-production')
app.config['SESSION_TYPE'] = 'filesystem'
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Production configuration
app.config['DEBUG'] = os.environ.get('DEBUG', False)
app.config['PREFERRED_URL_SCHEME'] = 'https'

Session(app)

# Database configuration
def get_db_connection():
    # Render provides DATABASE_URL environment variable
    database_url = os.environ.get('DATABASE_URL', 'postgresql://neondb_owner:npg_CzyA6c9imSWL@ep-noisy-sun-a41ubng9-pooler.us-east-1.aws.neon.tech/voting_db?sslmode=require')
    if database_url and database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)
    
    conn = psycopg2.connect(database_url, cursor_factory=RealDictCursor)
    return conn

# Setup logging
def setup_logging():
    if not os.path.exists('logs'):
        os.makedirs('logs')
    
    file_handler = RotatingFileHandler('logs/voting_system.log', maxBytes=10240, backupCount=10)
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    ))
    file_handler.setLevel(logging.INFO)
    app.logger.addHandler(file_handler)
    app.logger.setLevel(logging.INFO)
    app.logger.info('Voting System startup')

# Initialize database
def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Your existing tables
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                name VARCHAR UNIQUE NOT NULL,
                academic_year VARCHAR NOT NULL,
                is_active BOOLEAN DEFAULT FALSE,
                created_date TIMESTAMP,
                description TEXT
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS positions (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                session_id INTEGER,
                display_order INTEGER DEFAULT 0,
                description TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
                UNIQUE(name, session_id)
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS candidates (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                position_id INTEGER,
                photo_filename VARCHAR,
                grade VARCHAR,
                manifesto TEXT,
                votes INTEGER DEFAULT 0,
                FOREIGN KEY (position_id) REFERENCES positions (id) ON DELETE CASCADE
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS voters (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                class VARCHAR NOT NULL,
                photo_filename VARCHAR,
                face_encoding BYTEA,
                is_verified BOOLEAN DEFAULT FALSE,
                has_voted BOOLEAN DEFAULT FALSE,
                registration_date TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS voting_log (
                id SERIAL PRIMARY KEY,
                session_id INTEGER,
                position_id INTEGER,
                candidate_id INTEGER,
                vote_timestamp TIMESTAMP,
                voter_id INTEGER,
                ip_address INET,
                FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
                FOREIGN KEY (position_id) REFERENCES positions (id) ON DELETE CASCADE,
                FOREIGN KEY (candidate_id) REFERENCES candidates (id) ON DELETE CASCADE,
                FOREIGN KEY (voter_id) REFERENCES voters (id) ON DELETE CASCADE
            )
        ''')
        
        # Audit log for transparency
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS audit_log (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                action VARCHAR NOT NULL,
                details TEXT,
                user_ip INET
            )
        ''')
        
        # Create indexes for better performance
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_voters_face ON voters(face_encoding)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_voting_log_timestamp ON voting_log(vote_timestamp)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_candidates_position ON candidates(position_id)')
        
        conn.commit()
        app.logger.info("Database initialized successfully")
        
    except Exception as e:
        app.logger.error(f"Database initialization error: {str(e)}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

def log_audit(action, details, ip_address):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO audit_log (action, details, user_ip) VALUES (%s, %s, %s)",
            (action, details, ip_address)
        )
        conn.commit()
        app.logger.info(f"Audit log: {action} - {details}")
    except Exception as e:
        app.logger.error(f"Audit log error: {str(e)}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

# Error handlers
@app.errorhandler(404)
def not_found_error(error):
    return render_template('404.html'), 404

@app.errorhandler(500)
def internal_error(error):
    return render_template('500.html'), 500

# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/admin')
def admin_dashboard():
    return render_template('admin.html')

@app.route('/voting')
def voting_station():
    return render_template('voting.html')

@app.route('/results')
def live_results():
    return render_template('results.html')

@app.route('/voter-registration')
def voter_registration():
    return render_template('voter_registration.html')

# API Routes
@app.route('/api/sessions', methods=['GET', 'POST'])
def handle_sessions():
    if request.method == 'GET':
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT * FROM sessions ORDER BY created_date DESC")
            sessions = cursor.fetchall()
            return jsonify([dict(session) for session in sessions])
        except Exception as e:
            app.logger.error(f"Error fetching sessions: {str(e)}")
            return jsonify({'error': 'Database error'}), 500
        finally:
            cursor.close()
            conn.close()
    
    elif request.method == 'POST':
        data = request.json
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            created_date = datetime.datetime.now()
            cursor.execute(
                "INSERT INTO sessions (name, academic_year, created_date, description) VALUES (%s, %s, %s, %s)",
                (data['name'], data['academic_year'], created_date, data.get('description', ''))
            )
            conn.commit()
            log_audit('SESSION_CREATED', f"New session: {data['name']}", request.remote_addr)
            return jsonify({'status': 'success'})
        except Exception as e:
            app.logger.error(f"Error creating session: {str(e)}")
            conn.rollback()
            return jsonify({'error': 'Database error'}), 500
        finally:
            cursor.close()
            conn.close()

@app.route('/api/voters', methods=['GET', 'POST'])
def handle_voters():
    if request.method == 'GET':
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT * FROM voters ORDER BY created_at DESC")
            voters = cursor.fetchall()
            return jsonify([dict(voter) for voter in voters])
        except Exception as e:
            app.logger.error(f"Error fetching voters: {str(e)}")
            return jsonify({'error': 'Database error'}), 500
        finally:
            cursor.close()
            conn.close()
    
    elif request.method == 'POST':
        name = request.form['name']
        student_class = request.form['class']
        photo = request.files['photo']
        
        try:
            # Save photo
            filename = secure_filename(f"{name}_{student_class}_{datetime.datetime.now().timestamp()}.jpg")
            photo_path = os.path.join(app.config['UPLOAD_FOLDER'], 'voters', filename)
            os.makedirs(os.path.dirname(photo_path), exist_ok=True)
            photo.save(photo_path)
            
            # Generate face encoding
            image = face_recognition.load_image_file(photo_path)
            face_encodings = face_recognition.face_encodings(image)
            
            if len(face_encodings) > 0:
                face_encoding = face_encodings[0]
                encoding_blob = json.dumps(face_encoding.tolist()).encode('utf-8')
                
                conn = get_db_connection()
                cursor = conn.cursor()
                registration_date = datetime.datetime.now()
                cursor.execute(
                    "INSERT INTO voters (name, class, photo_filename, face_encoding, registration_date, is_verified) VALUES (%s, %s, %s, %s, %s, %s)",
                    (name, student_class, filename, encoding_blob, registration_date, True)
                )
                conn.commit()
                cursor.close()
                conn.close()
                
                log_audit('VOTER_REGISTERED', f"New voter: {name} ({student_class})", request.remote_addr)
                return jsonify({'status': 'success', 'message': 'Voter registered successfully'})
            else:
                return jsonify({'status': 'error', 'message': 'No face detected in photo'}), 400
                
        except Exception as e:
            app.logger.error(f"Error registering voter: {str(e)}")
            return jsonify({'status': 'error', 'message': 'Registration failed'}), 500

@app.route('/api/verify-voter', methods=['POST'])
def verify_voter():
    data = request.json
    try:
        webcam_image_data = data['image'].split(',')[1]
        
        # Decode base64 image
        image_data = base64.b64decode(webcam_image_data)
        nparr = np.frombuffer(image_data, np.uint8)
        webcam_image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Convert to RGB (face_recognition uses RGB)
        rgb_image = cv2.cvtColor(webcam_image, cv2.COLOR_BGR2RGB)
        
        # Find faces in webcam image
        face_locations = face_recognition.face_locations(rgb_image)
        face_encodings = face_recognition.face_encodings(rgb_image, face_locations)
        
        if len(face_encodings) == 0:
            return jsonify({'status': 'error', 'message': 'No face detected'})
        
        # Compare with registered voters
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, face_encoding, has_voted FROM voters WHERE is_verified = TRUE")
        voters = cursor.fetchall()
        
        for voter in voters:
            voter_id = voter['id']
            voter_name = voter['name']
            encoding_blob = voter['face_encoding']
            has_voted = voter['has_voted']
            
            if encoding_blob:
                stored_encoding = json.loads(encoding_blob.decode('utf-8'))
                stored_encoding = np.array(stored_encoding)
                
                # Compare faces with tolerance for slight variations
                matches = face_recognition.compare_faces([stored_encoding], face_encodings[0], tolerance=0.6)
                
                if matches[0]:
                    if has_voted:
                        return jsonify({'status': 'error', 'message': 'This voter has already voted'})
                    
                    # Store voter ID in session
                    session['voter_id'] = voter_id
                    session['voter_name'] = voter_name
                    
                    log_audit('VOTER_VERIFIED', f"Voter verified: {voter_name}", request.remote_addr)
                    return jsonify({'status': 'success', 'voter_name': voter_name})
        
        return jsonify({'status': 'error', 'message': 'Voter not recognized'})
        
    except Exception as e:
        app.logger.error(f"Error in voter verification: {str(e)}")
        return jsonify({'status': 'error', 'message': 'Verification failed'}), 500

@app.route('/api/vote', methods=['POST'])
def cast_vote():
    if 'voter_id' not in session:
        return jsonify({'status': 'error', 'message': 'Voter not verified'}), 401
    
    data = request.json
    voter_id = session['voter_id']
    candidate_id = data['candidate_id']
    position_id = data['position_id']
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Record vote
        vote_timestamp = datetime.datetime.now()
        cursor.execute(
            "INSERT INTO voting_log (session_id, position_id, candidate_id, vote_timestamp, voter_id, ip_address) VALUES (%s, %s, %s, %s, %s, %s)",
            (get_active_session_id(), position_id, candidate_id, vote_timestamp, voter_id, request.remote_addr)
        )
        
        # Update candidate vote count
        cursor.execute("UPDATE candidates SET votes = votes + 1 WHERE id = %s", (candidate_id,))
        
        # Mark voter as voted
        cursor.execute("UPDATE voters SET has_voted = TRUE WHERE id = %s", (voter_id,))
        
        conn.commit()
        
        log_audit('VOTE_CAST', f"Voter {voter_id} voted for candidate {candidate_id}", request.remote_addr)
        return jsonify({'status': 'success'})
        
    except Exception as e:
        app.logger.error(f"Error casting vote: {str(e)}")
        conn.rollback()
        return jsonify({'status': 'error', 'message': 'Vote failed'}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/live-results')
def get_live_results():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        active_session_id = get_active_session_id()
        if not active_session_id:
            return jsonify({})
        
        cursor.execute('''
            SELECT p.id as position_id, p.name as position_name, 
                   c.id as candidate_id, c.name as candidate_name, c.votes 
            FROM positions p 
            LEFT JOIN candidates c ON p.id = c.position_id 
            WHERE p.session_id = %s
            ORDER BY p.display_order, c.votes DESC
        ''', (active_session_id,))
        
        results = cursor.fetchall()
        
        # Format results
        formatted_results = {}
        for row in results:
            position_id = row['position_id']
            if position_id not in formatted_results:
                formatted_results[position_id] = {
                    'position_name': row['position_name'],
                    'candidates': []
                }
            if row['candidate_id']:  # Some positions might not have candidates
                formatted_results[position_id]['candidates'].append({
                    'id': row['candidate_id'],
                    'name': row['candidate_name'],
                    'votes': row['votes']
                })
        
        return jsonify(formatted_results)
        
    except Exception as e:
        app.logger.error(f"Error fetching results: {str(e)}")
        return jsonify({'error': 'Database error'}), 500
    finally:
        cursor.close()
        conn.close()

@app.route('/api/audit-log')
def get_audit_log():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT timestamp, action, details, user_ip 
            FROM audit_log 
            ORDER BY timestamp DESC 
            LIMIT 100
        """)
        log_entries = cursor.fetchall()
        return jsonify([dict(entry) for entry in log_entries])
    except Exception as e:
        app.logger.error(f"Error fetching audit log: {str(e)}")
        return jsonify({'error': 'Database error'}), 500
    finally:
        cursor.close()
        conn.close()

def get_active_session_id():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM sessions WHERE is_active = TRUE LIMIT 1")
        result = cursor.fetchone()
        return result['id'] if result else None
    except Exception as e:
        app.logger.error(f"Error getting active session: {str(e)}")
        return None
    finally:
        cursor.close()
        conn.close()

if __name__ == '__main__':
    setup_logging()
    init_db()
    
    # For production, use waitress or gunicorn instead of flask dev server
    if os.environ.get('PRODUCTION', False):
        from waitress import serve
        serve(app, host='0.0.0.0', port=5000)
    else:
        app.run(debug=True, host='0.0.0.0')