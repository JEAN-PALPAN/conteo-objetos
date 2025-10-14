require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Crear tabla si no existe
async function initDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS detections (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      source VARCHAR(50),
      total_objects INTEGER,
      unique_objects INTEGER,
      avg_confidence DECIMAL(5,2),
      detected_objects VARCHAR(500),
      objects_data JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  try {
    await pool.query(createTableQuery);
  } catch (error) {
    console.error('Error creando tabla:', error);
  }
}

initDatabase();

// Headers CORS
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

// Manejar OPTIONS (CORS preflight)
async function handleOptions() {
  return {
    statusCode: 200,
    headers,
    body: ''
  };
}

// GET /api/health
async function handleHealth() {
  try {
    const result = await pool.query('SELECT NOW()');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'ok',
        database: 'connected',
        timestamp: result.rows[0].now
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        status: 'error',
        message: error.message
      })
    };
  }
}

// POST /api/detections
async function handlePostDetections(body) {
  try {
    const { source, objects } = JSON.parse(body);
    
    if (!objects || objects.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No hay objetos para guardar' })
      };
    }

    const totalObjects = objects.length;
    const uniqueObjects = new Set(objects.map(obj => obj.class)).size;
    const avgConfidence = (objects.reduce((sum, obj) => sum + obj.score, 0) / totalObjects) * 100;
    
    const objectNames = objects.map(obj => obj.class);
    const objectCounts = {};
    objectNames.forEach(name => {
      objectCounts[name] = (objectCounts[name] || 0) + 1;
    });
    
    const detectedObjectsText = Object.entries(objectCounts)
      .map(([name, count]) => `${name} (${count})`)
      .join(', ');

    const insertQuery = `
      INSERT INTO detections (source, total_objects, unique_objects, avg_confidence, detected_objects, objects_data)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;

    const values = [
      source || 'camera',
      totalObjects,
      uniqueObjects,
      avgConfidence.toFixed(2),
      detectedObjectsText,
      JSON.stringify(objects)
    ];

    const result = await pool.query(insertQuery, values);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Detección guardada exitosamente',
        data: result.rows[0]
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Error guardando en base de datos',
        details: error.message
      })
    };
  }
}

// GET /api/detections
async function handleGetDetections(query) {
  try {
    const limit = query.limit || 50;
    
    const result = await pool.query(
      `SELECT id, timestamp, source, total_objects, unique_objects, 
              avg_confidence, detected_objects, objects_data, created_at
       FROM detections
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: result.rows.length,
        data: result.rows
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Error obteniendo datos',
        details: error.message
      })
    };
  }
}

// GET /api/stats
async function handleStats() {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_detections,
        SUM(total_objects) as total_objects_detected,
        AVG(avg_confidence) as overall_avg_confidence,
        MAX(total_objects) as max_objects_in_detection
      FROM detections;
    `);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        stats: result.rows[0]
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Error obteniendo estadísticas',
        details: error.message
      })
    };
  }
}

// DELETE /api/detections
async function handleDeleteDetections() {
  try {
    await pool.query('DELETE FROM detections');
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Todas las detecciones han sido eliminadas'
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Error eliminando datos',
        details: error.message
      })
    };
  }
}

// Función principal
exports.handler = async (event) => {
  // Manejar CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return await handleOptions();
  }

  const path = event.path;
  const method = event.httpMethod;
  const query = event.queryStringParameters || {};
  const body = event.body || '';

  console.log(`${method} ${path}`);

  // Rutas
  if (path === '/.netlify/functions/api/health' && method === 'GET') {
    return await handleHealth();
  }
  
  if (path === '/.netlify/functions/api/detections' && method === 'POST') {
    return await handlePostDetections(body);
  }
  
  if (path === '/.netlify/functions/api/detections' && method === 'GET') {
    return await handleGetDetections(query);
  }
  
  if (path === '/.netlify/functions/api/stats' && method === 'GET') {
    return await handleStats();
  }
  
  if (path === '/.netlify/functions/api/detections' && method === 'DELETE') {
    return await handleDeleteDetections();
  }

  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: 'Ruta no encontrada' })
  };
};