const express = require('express');
const { Pool } = require('pg'); // Changed from mysql2 to pg
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'ep-noisy-sun-a41ubng9-pooler.us-east-1.aws.neon.tech',
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'neondb_owner',
  password: process.env.DB_PASSWORD || 'npg_CzyA6c9imSWL',
  database: process.env.DB_NAME || 'voting_db',
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000, // 10 second timeout
  idleTimeoutMillis: 30000,
  max: 20 // max number of clients in the pool
});

// Validate that all required environment variables are set
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
});

// Helper function to get database connection
async function getConnection() {
  return await pool.connect();
}

// API Routes
app.get('/api/election-data', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    
    // Get active session
    const sessions = await connection.query(
      'SELECT * FROM sessions WHERE is_active = true LIMIT 1'
    );
    
    if (sessions.rows.length === 0) {
      return res.json({ 
        activeSession: null,
        positions: [],
        statistics: {}
      });
    }

    const activeSession = sessions.rows[0];

    // Get all positions for active session
    const positions = await connection.query(
      `SELECT p.*, COUNT(DISTINCT v.id) as total_voters, 
              COUNT(DISTINCT vl.id) as votes_cast
       FROM positions p
       LEFT JOIN voters v ON 1=1
       LEFT JOIN voting_log vl ON vl.position_id = p.id AND vl.session_id = $1
       WHERE p.session_id = $2
       GROUP BY p.id
       ORDER BY p.display_order ASC`,
      [activeSession.id, activeSession.id]
    );

    // Get candidates with vote counts for each position
    const positionsWithCandidates = await Promise.all(
      positions.rows.map(async (position) => {
        const candidates = await connection.query(
          `SELECT c.*, COUNT(vl.id) as vote_count
           FROM candidates c
           LEFT JOIN voting_log vl ON vl.candidate_id = c.id AND vl.session_id = $1
           WHERE c.position_id = $2
           GROUP BY c.id
           ORDER BY c.votes DESC, c.name ASC`,
          [activeSession.id, position.id]
        );

        // Calculate percentages
        const totalVotes = candidates.rows.reduce((sum, candidate) => sum + parseInt(candidate.vote_count), 0);
        const candidatesWithPercentages = candidates.rows.map(candidate => ({
          ...candidate,
          percentage: totalVotes > 0 ? ((parseInt(candidate.vote_count) / totalVotes) * 100).toFixed(1) : 0
        }));

        return {
          ...position,
          candidates: candidatesWithPercentages,
          total_votes: totalVotes
        };
      })
    );

    // Get overall statistics
    const totalVoters = await connection.query('SELECT COUNT(*) as count FROM voters');
    const votedVoters = await connection.query('SELECT COUNT(*) as count FROM voters WHERE has_voted = true');
    const totalVotes = await connection.query('SELECT COUNT(*) as count FROM voting_log WHERE session_id = $1', [activeSession.id]);
    
    const statistics = {
      total_voters: parseInt(totalVoters.rows[0].count),
      voted_voters: parseInt(votedVoters.rows[0].count),
      total_votes: parseInt(totalVotes.rows[0].count),
      turnout_percentage: totalVoters.rows[0].count > 0 ? 
        ((parseInt(votedVoters.rows[0].count) / parseInt(totalVoters.rows[0].count)) * 100).toFixed(1) : 0
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
    if (connection) connection.release(); // Changed from end() to release()
  }
});

app.get('/api/recent-votes', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    
    const recentVotes = await connection.query(
      `SELECT vl.vote_timestamp, v.name as voter_name, v.grade as voter_grade,
              c.name as candidate_name, p.name as position_name
       FROM voting_log vl
       JOIN voters v ON vl.voter_id = v.id
       JOIN candidates c ON vl.candidate_id = c.id
       JOIN positions p ON vl.position_id = p.id
       ORDER BY vl.vote_timestamp DESC
       LIMIT 20`
    );

    res.json(recentVotes.rows);
  } catch (error) {
    console.error('Error fetching recent votes:', error);
    res.status(500).json({ error: 'Failed to fetch recent votes' });
  } finally {
    if (connection) connection.release(); // Changed from end() to release()
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      status: 'OK', 
      database: 'Connected',
      timestamp: result.rows[0].now 
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'Error', 
      database: 'Disconnected',
      error: error.message 
    });
  }
});

module.exports = app;
