require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ADODB = require("node-adodb");
const sql = require("mssql/msnodesqlv8");
// const sql = require('mssql');
const cors = require("cors");

const app = express();
app.use(cors());

app.use(express.json());

// Configure SQL Server connection
const sqlConfig = {
  server: "LAPTOP-JO66B6L3\\SQLEXPRESS", // Use 'server' instead of 'host' for mssql
  database: "DPSTEST",
  options: {
    trustedConnection: true,
    // encrypt: true,
    // trustServerCertificate: true  // Needed for local development
  },
};

sql
  .connect(sqlConfig)
  .then((pool) => {
    console.log("Connected to SQL Server");
    return pool.close(); // Close the connection when done
  })
  .catch((err) => {
    console.error("Database connection failed:", err);
  });

const upload = multer({ dest: "uploads/" });

// Example of connecting to the database

async function importBatch(pool, tableName, batch) {
  const columns = Object.keys(batch[0]);
  const insertQuery = `INSERT INTO ${tableName} (${columns.join(
    ", "
  )}) VALUES `;

  const values = batch
    .map(
      (record) =>
        `(${columns
          .map((col) => {
            const value =
              record[col] === null
                ? "NULL"
                : `'${String(record[col]).replace(/'/g, "''")}'`;
            return value;
          })
          .join(", ")})`
    )
    .join(", ");

  await pool.request().query(insertQuery + values);
}

// Proper shutdown handling


// API END POINT FOR MDB FILE IMPORT
// app.post("/api/import-mdb", upload.single("mdbFile"), async (req, res) => {
//   console.log("Import request received", req.file);

//   if (!req.file) {
//     return res.status(400).json({ error: "No file uploaded" });
//   }

//   const filePath = req.file.path;

//   try {
//     // Initialize ADODB with extended timeout
//     const connection = ADODB.open(
//     //   `Provider=Microsoft.ACE.OLEDB.12.0;Data Source=${filePath}; Persist Security Info=False;
//     //   Jet OLEDB:Database Password=;
//     //   Extended Properties="";
//     // .replace(/\n/g, '').trim();`,
//     `Provider=Microsoft.ACE.OLEDB.12.0;Data Source=${filePath};` +
//       {
//         json: true,
//         timeout: 60000, // 60 second timeout
//       }
//     );

//     // Alternative table listing approach
//     let tables;
//     try {
//       tables = await connection.query(`
//         SELECT Name 
//         FROM [MSysObjects] 
//         WHERE Type IN (1, 4, 6) 
//           AND Flags = 0
//           AND Name NOT LIKE 'MSys%'
//       `);
//     } catch (msysError) {
//       console.warn("MSysObjects access failed, trying alternative method");
//       // Fallback to hardcoded table names if you know them
//       tables = [{ Name: "StudentMaster" }, { Name: "ClassMaster" }, { Name: "SubjectMaster" }];
//     }

//     console.log(`Found ${tables.length} tables to import`);

//     const importResults = [];
//     const pool = await sql.connect(sqlConfig);

//     for (const table of tables) {
//       try {
//         const tableName = table.Name;
//         console.log(`Processing table: ${tableName}`);

//         // Get table data with error handling
//         let data;
//         try {
//           data = await connection.query(`SELECT TOP 5000 * FROM [${tableName}]`); // Start with limited rows
//         } catch (queryError) {
//           console.error(`Query failed for ${tableName}:`, queryError);
//           importResults.push({
//             table: tableName,
//             status: "error",
//             error: "Failed to read table data",
//           });
//           continue;
//         }

//         if (data && data.length > 0) {
//           const columns = Object.keys(data[0]);
//           let createQuery = `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '${tableName}') 
//                            CREATE TABLE ${tableName} (`;
//           createQuery += columns
//             .map((col) => `${col} NVARCHAR(MAX)`)
//             .join(", ");
//           createQuery += ")";

//           await pool.request().query(createQuery);

//           // Batch insert data
//           const batchSize = 100;
//           for (let i = 0; i < data.length; i += batchSize) {
//             const batch = data.slice(i, i + batchSize);
//             await importBatch(pool, tableName, batch);
//           }

//           importResults.push({
//             table: tableName,
//             records: data.length,
//             status: "success",
//           });
//         }
//       } catch (err) {
//         console.error(`Table ${table.Name} processing failed:`, err);
//         importResults.push({
//           table: table.Name,
//           status: "error",
//           error: err.message,
//         });
//       }
//     }

//     fs.unlinkSync(filePath);
//     res.json({ message: "Import completed", results: importResults });
//   } catch (err) {
//     console.error("Import failed:", err);
//     if (fs.existsSync(filePath)) {
//       fs.unlinkSync(filePath);
//     }
//     res.status(500).json({
//       error: "Import failed",
//       details: err.message,
//     });
//   }
// });


app.post("/api/import-mdb", upload.single("mdbFile"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filePath = req.file.path;
  let pool;
  let connection;

  try {
    // 1. Connect to MDB file and get SchoolID
    connection = ADODB.open(
      `Provider=Microsoft.ACE.OLEDB.12.0;Data Source=${filePath};`,
      { json: true, timeout: 60000 }
    );

    const configResult = await connection.query("SELECT TOP 1 SchoolID FROM DatabaseConfig");
    const SchoolID = configResult?.[0]?.SchoolID;
    if (!SchoolID) throw new Error("SchoolID not found in DatabaseConfig");

    // 2. Get student data
    const students = await connection.query("SELECT * FROM StudentMaster");
    if (!students?.length) throw new Error("No student records found");

    // 3. Connect to SQL Server
    pool = await sql.connect(sqlConfig);

    // 4. Verify/Create table structure
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'StudentMaster')
      BEGIN
        CREATE TABLE StudentMaster (
          SchoolID INT NOT NULL,
          Scholarno NVARCHAR(50) NOT NULL,
          StudentName NVARCHAR(100) NOT NULL,
          Sex NVARCHAR(20),
          FatherName NVARCHAR(100),
          MotherName NVARCHAR(100),
          DOB DATE,
          FatherPhone NVARCHAR(15),
          AppliedClass NVARCHAR(20),
          SectionName NVARCHAR(15),
          FatherAddress NVARCHAR(200),
          PRIMARY KEY (SchoolID, Scholarno)
        )
        PRINT 'StudentMaster table created successfully'
      END
    `);

    // 5. Prepare for bulk insert
    const table = new sql.Table('StudentMaster');
    table.columns.add('SchoolID', sql.Int, { nullable: false });
    table.columns.add('Scholarno', sql.NVarChar(50), { nullable: false });
    table.columns.add('StudentName', sql.NVarChar(100), { nullable: false });
    table.columns.add('Sex', sql.Char(1), { nullable: true });
    table.columns.add('FatherName', sql.NVarChar(100), { nullable: true });
    table.columns.add('MotherName', sql.NVarChar(100), { nullable: true });
    table.columns.add('DOB', sql.Date, { nullable: true });
    table.columns.add('FatherPhone', sql.NVarChar(15), { nullable: true });
    table.columns.add('AppliedClass', sql.NVarChar(20), { nullable: true });
    table.columns.add('SectionName', sql.Char(1), { nullable: true });
    table.columns.add('FatherAddress', sql.NVarChar(200), { nullable: true });

    // 6. Process records
    const errors = [];
    for (const [index, student] of students.entries()) {
      try {
        table.rows.add(
          SchoolID,
          String(student.Scholarno) || null,
          String(student.StudentName || '').trim().substring(0, 100),
          String(student.Sex) || '',
          student.FatherName ? String(student.FatherName).trim().substring(0, 100) : null,
          student.MotherName ? String(student.MotherName).trim().substring(0, 100) : null,
          student.DOB ? new Date(student.DOB) : null,
          student.FatherPhone ? String(student.FatherPhone).trim().substring(0, 15) : null,
          student.AppliedClass ? String(student.AppliedClass).trim().substring(0, 20) : null,
          student.SectionName ? String(student.SectionName).trim().substring(0, 20) : null,
          student.FatherAddress ? String(student.FatherAddress).trim().substring(0, 200) : null
        );
      } catch (err) {
        errors.push({
          index,
          scholarno: student.Scholarno,
          error: err.message
        });
      }
    }

    // 7. Execute bulk insert
    const request = pool.request();
    const result = await request.bulk(table);

    // 8. Clean up
    fs.unlinkSync(filePath);
    return res.json({
      success: true,
      totalRecords: students.length,
      insertedRecords: students.length - errors.length,
      failedRecords: errors.length,
      errors
    });

  } catch (err) {
    console.error("Import failed:", err);
    return res.status(500).json({
      error: "Import failed",
      details: err.message
    });
  } finally {
     // Proper cleanup
    try {
      if (pool) await pool.close();
    } catch (err) {
      console.error("Error closing SQL connection:", err);
    }
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Error deleting temp file:", err);
      }
    }
  }
});


app.post('/api/v1/students', async (req, res) => {
  const {
    SchoolID,
    Scholarno,
    StudentName,
    Sex,
    FatherName,
    MotherName,
    DOB,
    FatherPhone,
    AppliedClass,
    SectionName,
    FatherAddress
  } = req.body;

  // Get schoolId from your system (could be from auth token, config, etc.)
  console.log(req.body, 'xyz')
  // if (!Scholarno || !StudentName || !Sex || !Appliedclass || !SectionName) {
  //   return res.status(400).json({ 
  //     error: 'Scholarno, StudentName, Sex, AppliedClass, SectionName are required fields' 
  //   });
  // }

  let pool;
  try {
    pool = await sql.connect(sqlConfig);

    // Insert student record
    const result = await pool.request()
      .input('SchoolID', sql.Int, SchoolID)
      .input('Scholarno', sql.NVarChar(50), Scholarno)
      .input('StudentName', sql.NVarChar(100), StudentName)
      .input('Sex', sql.NVarChar(10), Sex)
      .input('FatherName', sql.NVarChar(100), FatherName || null)
      .input('MotherName', sql.NVarChar(100), MotherName || null)
      .input('DOB', sql.Date, DOB ? new Date(DOB) : null)
      .input('FatherPhone', sql.NVarChar(15), FatherPhone || null)
      .input('AppliedClass', sql.NVarChar(20), AppliedClass)
      .input('SectionName', sql.NVarChar(20), SectionName || null)
      .input('FatherAddress', sql.NVarChar(200), FatherAddress || null)
      .query(`
        INSERT INTO StudentMaster (
          SchoolID, Scholarno, StudentName, Sex, FatherName,
          MotherName, DOB, FatherPhone, AppliedClass, SectionName, FatherAddress
        ) VALUES (
          @SchoolID, @Scholarno, @StudentName, @Sex, @FatherName,
          @MotherName, @DOB, @FatherPhone, @AppliedClass, @SectionName, @FatherAddress
        )
      `);

    return res.status(201).json({
      success: true,
      message: 'Student record created successfully',
      Scholarno
    });

  } catch (err) {
    console.error('Error inserting student:', err);
    
    if (err.number === 2627) { // SQL Server duplicate key error
      return res.status(409).json({
        error: 'Student with this ScholarNo already exists'
      });
    }

    return res.status(500).json({
      error: 'Failed to create student record',
      details: err.message
    });
  } finally {
    if (pool) await pool.close();
  }
});

// PUT endpoint to update student data
app.put('/api/v1/students/:Scholarno', async (req, res) => {
    const Scholarno = parseInt(req.params.Scholarno);
    const {
        SchoolID,
        StudentName,
        Sex,
        FatherName,
        MotherName,
        DOB,
        FatherPhone,
        AppliedClass,
        SectionName,
        FatherAddress
    } = req.body;

    // Validate required fields
    if (!SchoolID || !StudentName || !Sex || !AppliedClass || !SectionName) {
        return res.status(400).json({ 
            error: 'SchoolID, StudentName, Sex, AppliedClass, and SectionName are required fields' 
        });
    }

    // Validate and parse date
    let dobDate = null;
    if (DOB) {
        dobDate = new Date(DOB);
        if (isNaN(dobDate.getTime())) {
            return res.status(400).json({ 
                error: 'Invalid date format. Use YYYY-MM-DD' 
            });
        }
    }

    let pool;
    try {
        pool = await sql.connect(sqlConfig);

        const result = await pool.request()
            .input('SchoolID', sql.Int, SchoolID)
            .input('Scholarno', sql.NVarChar(50), Scholarno)
            .input('StudentName', sql.NVarChar(100), StudentName)
            .input('Sex', sql.NVarChar(10), Sex)
            .input('FatherName', sql.NVarChar(100), FatherName || null)
            .input('MotherName', sql.NVarChar(100), MotherName || null)
            .input('DOB', sql.Date, dobDate)
            .input('FatherPhone', sql.NVarChar(15), FatherPhone || null)
            .input('AppliedClass', sql.NVarChar(20), AppliedClass)
            .input('SectionName', sql.NVarChar(20), SectionName)
            .input('FatherAddress', sql.NVarChar(200), FatherAddress || null)
            .query(`
                UPDATE StudentMaster SET
                    StudentName = @StudentName,
                    Sex = @Sex,
                    FatherName = @FatherName,
                    MotherName = @MotherName,
                    DOB = @DOB,
                    FatherPhone = @FatherPhone,
                    AppliedClass = @AppliedClass,
                    SectionName = @SectionName,
                    FatherAddress = @FatherAddress
                WHERE Scholarno = @Scholarno AND SchoolID = @SchoolID
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ 
                error: 'Student not found' 
            });
        }

        return res.json({ 
            success: true,
            message: 'Student updated successfully',
            Scholarno
        });

    } catch (err) {
        console.error('Error updating student:', err);
        return res.status(500).json({ 
            error: 'Failed to update student',
            details: err.message
        });
    } finally {
        if (pool) await pool.close();
    }
});


process.on("SIGINT", async () => {
  await pool.close();
  process.exit();
});

app.listen(3000, () => {
  console.log(`Server running on port  http://localhost:3002`);
});
