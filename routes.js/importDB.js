const upload = multer({ dest: 'uploads/' });

app.post('/api/import-mdb', upload.single('mdbFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const connectionString = `Provider=Microsoft.ACE.OLEDB.12.0;Data Source=${filePath};`;

    // Connect to the MDB file
    const connection = ADODB.open(connectionString);

    // Get all tables from the MDB file
    const tables = await connection.query('SELECT Name FROM MSysObjects WHERE Type=1 AND Flags=0');

    const importResults = [];

    // Ensure SQL connection is ready
    await poolConnect;

    // Process each table
    for (const table of tables) {
      try {
        const tableName = table.Name;
        if (tableName.startsWith('MSys')) continue; // Skip system tables

        // Get all data from the table
        const data = await connection.query(`SELECT * FROM [${tableName}]`);

        // Import to SQL Server
        if (data.length > 0) {
          const columns = Object.keys(data[0]);
          
          // Create table if not exists
          let createTableQuery = `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '${tableName}') 
                                 CREATE TABLE ${tableName} (`;
          
          // Add columns (using NVARCHAR(MAX) for all fields for simplicity)
          createTableQuery += columns.map(col => `${col} NVARCHAR(MAX)`).join(', ');
          createTableQuery += ')';
          
          await pool.request().query(createTableQuery);
          
          // Insert data using parameterized queries
          for (const row of data) {
            const insertQuery = `INSERT INTO ${tableName} (${columns.join(', ')}) 
                               VALUES (${columns.map((_, i) => `@${i}`).join(', ')})`;
            
            const request = pool.request();
            
            // Add parameters
            columns.forEach((col, i) => {
              request.input(`${i}`, sql.NVarChar, row[col] !== null ? row[col].toString() : null);
            });
            
            await request.query(insertQuery);
          }
          
          importResults.push({
            table: tableName,
            records: data.length,
            status: 'success'
          });
        }
      } catch (err) {
        importResults.push({
          table: table.Name,
          status: 'error',
          error: err.message
        });
      }
    }

    // Clean up - delete the uploaded file
    fs.unlinkSync(filePath);

    res.json({
      message: 'Import completed',
      results: importResults
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});



import React, { useState } from 'react';
import axios from 'axios';
import './importData.css';

const ImportData = () => {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setProgress(0);
    
    const formData = new FormData();
    formData.append('mdbFile', file);

    try {
      const response = await axios.post('http://localhost:3000/api/import-mdb', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setProgress(percentCompleted);
        }
      });
      setResults(response.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="container">
      <h1>MDB to SQL Database Importer</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="mdbFile">Select MDB File:</label>
          <input
            type="file"
            id="mdbFile"
            accept=".mdb,.accdb"
            onChange={handleFileChange}
            required
          />
        </div>
        <button 
          style={{
            background: 'coral', 
            color: 'white', 
            padding: '10px 15px', 
            borderRadius: '5px',
            marginBottom: '10px'
          }} 
          type="submit" 
          disabled={isUploading}
        >
          {isUploading ? 'Importing...' : 'Import to SQL'}
        </button>
        
        {isUploading && (
          <div className="progress-container">
            <div 
              className="progress-bar" 
              style={{ width: `${progress}%` }}
            ></div>
            <div className="progress-text">{progress}%</div>
          </div>
        )}
      </form>

      {error && <div className="error">{error}</div>}

      {results && (
        <div className="results">
          <h2>Import Results</h2>
          <p>{results.message}</p>
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th>Records</th>
                <th>Status</th>
                {results.results.some(r => r.error) && <th>Error</th>}
              </tr>
            </thead>
            <tbody>
              {results.results.map((result, index) => (
                <tr key={index}>
                  <td>{result.table}</td>
                  <td>{result.records || '-'}</td>
                  <td>{result.status}</td>
                  {result.error && <td className="error">{result.error}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ImportData;