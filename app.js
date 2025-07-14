require("dotenv").config();
const express = require("express");
const multer = require("multer");
// const path = require("path");
const fs = require("fs");
const ADODB = require("node-adodb");
// const sql = require("mssql/msnodesqlv8");
const sql = require('mssql');
const cors = require("cors");

const app = express();
app.use(cors());

app.use(express.json());

// Configure SQL Server connection
const sqlConfig = {
  // server: "LAPTOP-JO66B6L3\\SQLEXPRESS", // Use 'server' instead of 'host' for mssql
  // database: "DPSTEST",
  // options: {
  //   trustedConnection: true,
  //   // encrypt: true,
  //   // trustServerCertificate: true  // Needed for local development
  // },
  user: "dpsuser",
    password: "dps@123",
    server: "150.242.203.229", // SQL Server address
    database: "Enlighten_DB",
    options: {
      encrypt: false, // Set to true if using Azure
      enableArithAbort: true,
      multipleActiveResultSets: true,
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

// async function importBatch(pool, tableName, batch) {
//   const columns = Object.keys(batch[0]);
//   const insertQuery = `INSERT INTO ${tableName} (${columns.join(
//     ", "
//   )}) VALUES `;

//   const values = batch
//     .map(
//       (record) =>
//         `(${columns
//           .map((col) => {
//             const value =
//               record[col] === null
//                 ? "NULL"
//                 : `'${String(record[col]).replace(/'/g, "''")}'`;
//             return value;
//           })
//           .join(", ")})`
//     )
//     .join(", ");

//   await pool.request().query(insertQuery + values);
// }




app.post("/api/import-mdb", upload.single("mdbFile"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filePath = req.file.path;
  let pool;
  let connection;

  try {
    // 1. Connect to MDB file and get SchoolID and school_code
    connection = ADODB.open(
      `Provider=Microsoft.ACE.OLEDB.12.0;Data Source=${filePath};`,
      { json: true, timeout: 60000 }
    );

    const configResult = await connection.query("SELECT TOP 1 school_Id, school_code FROM DatabaseConfig");
    const school_Id = configResult?.[0]?.school_Id;
    const school_code = configResult?.[0]?.school_code; // Optional field
    const created_date = Date.now();
    if (!school_Id) throw new Error("SchoolID not found in DatabaseConfig");

    // 2. Get student data
    const students = await connection.query("SELECT * FROM StudentMaster");
    if (!students?.length) throw new Error("No student records found");

    // 3. Connect to SQL Server
    pool = await sql.connect(sqlConfig);

    // 4. Verify/Create table structure
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Student_Master')
      BEGIN
        CREATE TABLE Studen_tMaster (
          id INT IDENTITY(1,1),
          StudentName NVARCHAR(100),
          StudentSurName NVARCHAR(100),
          DOA NVARCHAR(100),
          DOB DATETIME,
          Language NVARCHAR(50),
          Sex NVARCHAR(100),
          PhoneNo NVARCHAR(10),
          FatherName NVARCHAR(100),
          FatherAddress NVARCHAR(100),
          FatherPhone NVARCHAR(50),
          FatherOccupation NVARCHAR(50),
          MotherName NVARCHAR(100),
          MotherPhone NVARCHAR(50),
          AppliedClass NVARCHAR(50),
          AppliedStream NVARCHAR(50),
          AppliedMedium NVARCHAR(50),
          SectionName NVARCHAR(50),
          Area NVARCHAR(50),
          Mode NVARCHAR(50),
          Board NVARCHAR(20),
          CasteName NVARCHAR(50),
          City NVARCHAR(150),
          Email NVARCHAR(150),
          created_date DATETIME DEFAULT GETDATE(),
          type NVARCHAR(50),
          school_Id NVARCHAR(50),
          school_code NVARCHAR(50),
          Scholarno NVARCHAR(50),
          img NVARCHAR(MAX),
          PRIMARY KEY (id),
          CONSTRAINT UQ_StudentMaster_School_Scholar UNIQUE (school_Id, Scholarno)
        )
        PRINT 'Student_Master table created successfully'
      END
    `);

    // 5. Prepare for bulk insert
    const table = new sql.Table('Student_Master');
    // Add all columns in the exact order they appear in the table
    table.columns.add('StudentName', sql.NVarChar(100), { nullable: true });
    table.columns.add('StudentSurName', sql.NVarChar(100), { nullable: true });
    table.columns.add('DOA', sql.NVarChar(100), { nullable: true });
    table.columns.add('DOB', sql.DateTime, { nullable: true });
    table.columns.add('Language', sql.NVarChar(50), { nullable: true });
    table.columns.add('Sex', sql.NVarChar(100), { nullable: true });
    table.columns.add('PhoneNo', sql.NVarChar(10), { nullable: true });
    table.columns.add('FatherName', sql.NVarChar(100), { nullable: true });
    table.columns.add('FatherAddress', sql.NVarChar(100), { nullable: true });
    table.columns.add('FatherPhone', sql.NVarChar(50), { nullable: true });
    table.columns.add('FatherOccupation', sql.NVarChar(50), { nullable: true });
    table.columns.add('MotherName', sql.NVarChar(100), { nullable: true });
    table.columns.add('MotherPhone', sql.NVarChar(50), { nullable: true });
    table.columns.add('AppliedClass', sql.NVarChar(50), { nullable: true });
    table.columns.add('AppliedStream', sql.NVarChar(50), { nullable: true });
    table.columns.add('AppliedMedium', sql.NVarChar(50), { nullable: true });
    table.columns.add('SectionName', sql.NVarChar(50), { nullable: true });
    table.columns.add('Area', sql.NVarChar(50), { nullable: true });
    table.columns.add('Mode', sql.NVarChar(50), { nullable: true });
    table.columns.add('Board', sql.NVarChar(20), { nullable: true });
    table.columns.add('CasteName', sql.NVarChar(50), { nullable: true });
    table.columns.add('City', sql.NVarChar(150), { nullable: true });
    table.columns.add('Email', sql.NVarChar(150), { nullable: true });
    table.columns.add('type', sql.NVarChar(50), { nullable: true });
    table.columns.add('school_Id', sql.NVarChar(50), { nullable: true });
    table.columns.add('school_code', sql.NVarChar(50), { nullable: true });
    table.columns.add('Scholarno', sql.NVarChar(50), { nullable: true });
    table.columns.add('img', sql.NVarChar(sql.MAX), { nullable: true });

    // 6. Process records
    const errors = [];
    for (const [index, student] of students.entries()) {
      try {
        table.rows.add(
          String(student.StudentName || '').trim().substring(0, 100),
          String(student.StudentSurName || '').trim().substring(0, 100),
          student.DOA ? String(student.DOA).trim().substring(0, 100) : null,
          student.DOB ? new Date(student.DOB) : null,
          student.Language ? String(student.Language).trim().substring(0, 50) : null,
          student.Sex ? String(student.Sex).trim().substring(0, 100) : null,
          student.PhoneNo ? String(student.PhoneNo).trim().substring(0, 10) : null,
          student.FatherName ? String(student.FatherName).trim().substring(0, 100) : null,
          student.FatherAddress ? String(student.FatherAddress).trim().substring(0, 100) : null,
          student.FatherPhone ? String(student.FatherPhone).trim().substring(0, 50) : null,
          student.FatherOccupation ? String(student.FatherOccupation).trim().substring(0, 50) : null,
          student.MotherName ? String(student.MotherName).trim().substring(0, 100) : null,
          student.MotherPhone ? String(student.MotherPhone).trim().substring(0, 50) : null,
          student.AppliedClass ? String(student.AppliedClass).trim().substring(0, 50) : null,
          student.AppliedStream ? String(student.AppliedStream).trim().substring(0, 50) : null,
          student.AppliedMedium ? String(student.AppliedMedium).trim().substring(0, 50) : null,
          student.SectionName ? String(student.SectionName).trim().substring(0, 50) : null,
          student.Area ? String(student.Area).trim().substring(0, 50) : null,
          student.Mode ? String(student.Mode).trim().substring(0, 50) : null,
          student.Board ? String(student.Board).trim().substring(0, 20) : null,
          student.CasteName ? String(student.CasteName).trim().substring(0, 50) : null,
          student.City ? String(student.City).trim().substring(0, 150) : null,
          student.Email ? String(student.Email).trim().substring(0, 150) : null,
          student.type ? String(student.type).trim().substring(0, 50) : null,
          school_Id,
          school_code,
          String(student.Scholarno || '').trim().substring(0, 50),
          student.img ? String(student.img).trim() : null
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
      errors,
      school_code // Include school_code in response
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
