// static/js/voting.js
class VotingSystem {
    constructor() {
        this.video = document.getElementById('webcam');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentPositionIndex = 0;
        this.positions = [];
        this.votedPositions = new Set();
        
        this.init();
    }
    
    async init() {
        await this.setupWebcam();
        this.setupEventListeners();
    }
    
    async setupWebcam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 400, height: 300 } 
            });
            this.video.srcObject = stream;
        } catch (err) {
            console.error('Error accessing webcam:', err);
            document.getElementById('verification-result').innerHTML = 
                '<div class="alert alert-danger">Could not access webcam. Please check permissions.</div>';
        }
    }
    
    setupEventListeners() {
        document.getElementById('capture-btn').addEventListener('click', () => {
            this.captureAndVerify();
        });
    }
    
    captureAndVerify() {
        // Draw current video frame to canvas
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        
        // Convert canvas to base64
        const imageData = this.canvas.toDataURL('image/jpeg');
        
        // Send to server for verification
        fetch('/api/verify-voter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image: imageData })
        })
        .then(response => response.json())
        .then(data => {
            const resultDiv = document.getElementById('verification-result');
            
            if (data.status === 'success') {
                resultDiv.innerHTML = `<div class="alert alert-success">
                    <strong>Verification Successful!</strong><br>
                    Welcome, ${data.voter_name}
                </div>`;
                
                document.getElementById('voter-info').innerHTML = `
                    <p><strong>Voter:</strong> ${data.voter_name}</p>
                    <p><strong>Status:</strong> Verified ✓</p>
                `;
                
                // Show voting section
                document.getElementById('face-verification-section').style.display = 'none';
                document.getElementById('voting-section').style.display = 'block';
                
                this.loadPositions();
                
            } else {
                resultDiv.innerHTML = `<div class="alert alert-danger">
                    <strong>Verification Failed:</strong> ${data.message}
                </div>`;
            }
        })
        .catch(error => {
            console.error('Error:', error);
            document.getElementById('verification-result').innerHTML = 
                '<div class="alert alert-danger">Error during verification. Please try again.</div>';
        });
    }
    
    loadPositions() {
        fetch('/api/positions')
        .then(response => response.json())
        .then(positions => {
            this.positions = positions;
            this.showCurrentPosition();
        });
    }
    
    showCurrentPosition() {
        if (this.currentPositionIndex >= this.positions.length) {
            this.showVotingComplete();
            return;
        }
        
        const position = this.positions[this.currentPositionIndex];
        const container = document.getElementById('positions-container');
        
        container.innerHTML = `
            <div class="position-card">
                <h5>${position.name}</h5>
                ${position.description ? `<p>${position.description}</p>` : ''}
                <div class="candidates-list" id="candidates-${position.id}">
                    Loading candidates...
                </div>
            </div>
        `;
        
        this.loadCandidates(position.id);
    }
    
    loadCandidates(positionId) {
        fetch(`/api/candidates?position_id=${positionId}`)
        .then(response => response.json())
        .then(candidates => {
            const container = document.getElementById(`candidates-${positionId}`);
            container.innerHTML = '';
            
            candidates.forEach(candidate => {
                const candidateDiv = document.createElement('div');
                candidateDiv.className = 'candidate-card';
                candidateDiv.innerHTML = `
                    <div class="candidate-info">
                        ${candidate.photo_filename ? 
                            `<img src="/static/uploads/candidates/${candidate.photo_filename}" 
                                  alt="${candidate.name}" class="candidate-photo">` : 
                            '<div class="candidate-photo placeholder">No Photo</div>'
                        }
                        <div>
                            <h6>${candidate.name}</h6>
                            ${candidate.grade ? `<p class="text-muted">${candidate.grade}</p>` : ''}
                            ${candidate.manifesto ? `<p>${candidate.manifesto}</p>` : ''}
                        </div>
                    </div>
                    <button class="btn btn-success vote-btn" 
                            data-candidate-id="${candidate.id}"
                            data-position-id="${positionId}">
                        Vote
                    </button>
                `;
                container.appendChild(candidateDiv);
            });
            
            // Add event listeners to vote buttons
            container.querySelectorAll('.vote-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const candidateId = e.target.dataset.candidateId;
                    const positionId = e.target.dataset.positionId;
                    this.castVote(candidateId, positionId);
                });
            });
        });
    }
    
    castVote(candidateId, positionId) {
        fetch('/api/vote', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                candidate_id: candidateId,
                position_id: positionId
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                this.votedPositions.add(positionId);
                this.currentPositionIndex++;
                this.showCurrentPosition();
            } else {
                alert('Error casting vote: ' + data.message);
            }
        });
    }
    
    showVotingComplete() {
        document.getElementById('voting-section').style.display = 'none';
        document.getElementById('voting-complete').style.display = 'block';
        
        // Stop webcam
        const stream = this.video.srcObject;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    }
}

// Initialize voting system when page loads
document.addEventListener('DOMContentLoaded', () => {
    new VotingSystem();
});