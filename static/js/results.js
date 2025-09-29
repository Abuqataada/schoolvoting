// static/js/results.js
class LiveResults {
    constructor() {
        this.resultsContainer = document.getElementById('results-container');
        this.auditLog = document.getElementById('audit-log');
        
        this.loadResults();
        this.loadAuditLog();
        
        // Update results every 5 seconds
        setInterval(() => {
            this.loadResults();
            this.loadAuditLog();
        }, 5000);
    }
    
    loadResults() {
        fetch('/api/live-results')
        .then(response => response.json())
        .then(results => {
            this.displayResults(results);
        })
        .catch(error => {
            console.error('Error loading results:', error);
        });
    }
    
    displayResults(results) {
        if (Object.keys(results).length === 0) {
            this.resultsContainer.innerHTML = `
                <div class="alert alert-info">
                    <h5>No Election Data Available</h5>
                    <p>No active election session or no votes cast yet.</p>
                </div>
            `;
            return;
        }
        
        let html = '';
        
        Object.values(results).forEach(position => {
            const totalVotes = position.candidates.reduce((sum, candidate) => sum + candidate.votes, 0);
            
            html += `
                <div class="position-results mb-4">
                    <h4>${position.position_name}</h4>
                    <div class="table-responsive">
                        <table class="table table-striped">
                            <thead>
                                <tr>
                                    <th>Rank</th>
                                    <th>Candidate</th>
                                    <th>Votes</th>
                                    <th>Percentage</th>
                                    <th>Visual</th>
                                </tr>
                            </thead>
                            <tbody>
            `;
            
            position.candidates.sort((a, b) => b.votes - a.votes);
            
            position.candidates.forEach((candidate, index) => {
                const percentage = totalVotes > 0 ? ((candidate.votes / totalVotes) * 100).toFixed(1) : 0;
                const barWidth = totalVotes > 0 ? (candidate.votes / totalVotes) * 100 : 0;
                
                html += `
                    <tr class="${index === 0 && candidate.votes > 0 ? 'table-success' : ''}">
                        <td>${index + 1}</td>
                        <td>${candidate.name}</td>
                        <td>${candidate.votes}</td>
                        <td>${percentage}%</td>
                        <td>
                            <div class="progress" style="height: 20px;">
                                <div class="progress-bar" role="progressbar" 
                                     style="width: ${barWidth}%" 
                                     aria-valuenow="${barWidth}" 
                                     aria-valuemin="0" 
                                     aria-valuemax="100">
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            });
            
            html += `
                            </tbody>
                            <tfoot>
                                <tr class="table-primary">
                                    <td colspan="2"><strong>Total Votes</strong></td>
                                    <td colspan="3"><strong>${totalVotes}</strong></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;
        });
        
        this.resultsContainer.innerHTML = html;
    }
    
    loadAuditLog() {
        fetch('/api/audit-log')
        .then(response => response.json())
        .then(logEntries => {
            let html = '';
            
            logEntries.forEach(entry => {
                const timestamp = new Date(entry[1]).toLocaleString();
                html += `
                    <div class="audit-entry mb-2 p-2 border-bottom">
                        <small class="text-muted">${timestamp}</small><br>
                        <strong>${entry[2]}</strong>: ${entry[3]}
                        <br><small>IP: ${entry[4]}</small>
                    </div>
                `;
            });
            
            this.auditLog.innerHTML = html || '<p>No audit entries yet.</p>';
        });
    }
}

// Initialize live results when page loads
document.addEventListener('DOMContentLoaded', () => {
    new LiveResults();
});