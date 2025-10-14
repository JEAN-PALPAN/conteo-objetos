require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Conexión a Neon.tech PostgreSQL
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
      objects_data JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  try {
    await pool.query(createTableQuery);
    console.log('✅ Tabla "detections" lista');
  } catch (error) {
    console.error('❌ Error creando tabla:', error);
  }
}

// Inicializar BD al arrancar
initDatabase();

// ========== RUTAS DE LA API ==========

// Verificar conexión
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      status: 'ok', 
      database: 'connected',
      timestamp: result.rows[0].now 
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// Guardar detección
// Guardar detección
app.post('/api/detections', async (req, res) => {
  try {
    const { source, objects } = req.body;
    
    if (!objects || objects.length === 0) {
      return res.status(400).json({ 
        error: 'No hay objetos para guardar' 
      });
    }

    const totalObjects = objects.length;
    const uniqueObjects = new Set(objects.map(obj => obj.class)).size;
    const avgConfidence = (objects.reduce((sum, obj) => sum + obj.score, 0) / totalObjects) * 100;
    
    // 🆕 CREAR LISTA DE NOMBRES DE OBJETOS
    const objectNames = objects.map(obj => obj.class);
    const objectCounts = {};
    objectNames.forEach(name => {
      objectCounts[name] = (objectCounts[name] || 0) + 1;
    });
    
    // Formato: "person (3), car (2), dog (1)"
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
      detectedObjectsText,  // 🆕 NUEVA COLUMNA
      JSON.stringify(objects)
    ];

    const result = await pool.query(insertQuery, values);
    
    res.json({
      success: true,
      message: 'Detección guardada exitosamente',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Error guardando detección:', error);
    res.status(500).json({ 
      error: 'Error guardando en base de datos',
      details: error.message 
    });
  }
});

// Obtener historial de detecciones
// Obtener historial de detecciones
app.get('/api/detections', async (req, res) => {
  try {
    const limit = req.query.limit || 50;
    
    const query = `
      SELECT id, timestamp, source, total_objects, unique_objects, 
             avg_confidence, detected_objects, objects_data, created_at
      FROM detections
      ORDER BY created_at DESC
      LIMIT $1;
    `;

    const result = await pool.query(query, [limit]);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ 
      error: 'Error obteniendo datos',
      details: error.message 
    });
  }
});

// Obtener estadísticas generales
app.get('/api/stats', async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_detections,
        SUM(total_objects) as total_objects_detected,
        AVG(avg_confidence) as overall_avg_confidence,
        MAX(total_objects) as max_objects_in_detection
      FROM detections;
    `;

    const result = await pool.query(statsQuery);
    
    res.json({
      success: true,
      stats: result.rows[0]
    });

  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ 
      error: 'Error obteniendo estadísticas',
      details: error.message 
    });
  }
});

// Eliminar todas las detecciones
app.delete('/api/detections', async (req, res) => {
  try {
    await pool.query('DELETE FROM detections');
    
    res.json({
      success: true,
      message: 'Todas las detecciones han sido eliminadas'
    });

  } catch (error) {
    console.error('Error eliminando detecciones:', error);
    res.status(500).json({ 
      error: 'Error eliminando datos',
      details: error.message 
    });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`
  🚀 Servidor API iniciado
  📡 Puerto: ${PORT}
  🌐 URL: http://localhost:${PORT}
  💾 Base de datos: Neon.tech PostgreSQL
  
  Endpoints disponibles:
  - GET  /api/health          (Verificar conexión)
  - POST /api/detections      (Guardar detección)
  - GET  /api/detections      (Obtener historial)
  - GET  /api/stats           (Estadísticas)
  - DELETE /api/detections    (Limpiar BD)
  `);
});

// Manejo de errores
process.on('unhandledRejection', (error) => {
  console.error('❌ Error no manejado:', error);
});