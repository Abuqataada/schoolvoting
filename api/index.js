const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database configuration from your Aiven setup
const dbConfig = {
  host: 'voting-db-abuqataada21-54f9.l.aivencloud.com',
  port: 23198,
  user: 'avnadmin',
  password: 'AVNS_IttvoCuWeY-kq_jQebf',
  database: 'defaultdb',
  ssl: {
    rejectUnauthorized: false
  }
};

// Helper function to get database connection
async function getConnection() {
  return await mysql.createConnection(dbConfig);
}

// API Routes
app.get('/api/election-data', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    
    // Get active session
    const [sessions] = await connection.execute(
      'SELECT * FROM sessions WHERE is_active = 1 LIMIT 1'
    );
    
    if (sessions.length === 0) {
      return res.json({ 
        activeSession: null,
        positions: [],
        statistics: {}
      });
    }

    const activeSession = sessions[0];

    // Get all positions for active session
    const [positions] = await connection.execute(
      `SELECT p.*, COUNT(DISTINCT v.id) as total_voters, 
              COUNT(DISTINCT vl.id) as votes_cast
       FROM positions p
       LEFT JOIN voters v ON 1=1
       LEFT JOIN voting_log vl ON vl.position_id = p.id AND vl.session_id = ?
       WHERE p.session_id = ?
       GROUP BY p.id
       ORDER BY p.display_order ASC`,
      [activeSession.id, activeSession.id]
    );

    // Get candidates with vote counts for each position
    const positionsWithCandidates = await Promise.all(
      positions.map(async (position) => {
        const [candidates] = await connection.execute(
          `SELECT c.*, COUNT(vl.id) as vote_count
           FROM candidates c
           LEFT JOIN voting_log vl ON vl.candidate_id = c.id AND vl.session_id = ?
           WHERE c.position_id = ?
           GROUP BY c.id
           ORDER BY c.votes DESC, c.name ASC`,
          [activeSession.id, position.id]
        );

        // Calculate percentages
        const totalVotes = candidates.reduce((sum, candidate) => sum + candidate.vote_count, 0);
        const candidatesWithPercentages = candidates.map(candidate => ({
          ...candidate,
          percentage: totalVotes > 0 ? ((candidate.vote_count / totalVotes) * 100).toFixed(1) : 0
        }));

        return {
          ...position,
          candidates: candidatesWithPercentages,
          total_votes: totalVotes
        };
      })
    );

    // Get overall statistics
    const [totalVoters] = await connection.execute('SELECT COUNT(*) as count FROM voters');
    const [votedVoters] = await connection.execute('SELECT COUNT(*) as count FROM voters WHERE has_voted = 1');
    const [totalVotes] = await connection.execute('SELECT COUNT(*) as count FROM voting_log WHERE session_id = ?', [activeSession.id]);
    
    const statistics = {
      total_voters: totalVoters[0].count,
      voted_voters: votedVoters[0].count,
      total_votes: totalVotes[0].count,
      turnout_percentage: ((votedVoters[0].count / totalVoters[0].count) * 100).toFixed(1)
    };

    res.json({
      activeSession,
      positions: positionsWithCandidates,
      statistics,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch election data',
      details: error.message 
    });
  } finally {
    if (connection) await connection.end();
  }
});

app.get('/api/recent-votes', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    
    const [recentVotes] = await connection.execute(
      `SELECT vl.vote_timestamp, v.name as voter_name, v.grade as voter_grade,
              c.name as candidate_name, p.name as position_name
       FROM voting_log vl
       JOIN voters v ON vl.voter_id = v.id
       JOIN candidates c ON vl.candidate_id = c.id
       JOIN positions p ON vl.position_id = p.id
       ORDER BY vl.vote_timestamp DESC
       LIMIT 20`
    );

    res.json(recentVotes);
  } catch (error) {
    console.error('Error fetching recent votes:', error);
    res.status(500).json({ error: 'Failed to fetch recent votes' });
  } finally {
    if (connection) await connection.end();
  }
});

module.exports = app;
