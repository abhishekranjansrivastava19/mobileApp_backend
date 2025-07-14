require("dotenv").config();
const express = require("express");
const multer = require("multer");
// const path = require("path");
const fs = require("fs");
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









app.post('/api/v1/students', async (req, res) => {
  const {
    school_Id,
    school_code,
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
      .input('school_Id', sql.Int, school_Id)
      .input('school_code', sql.Int, school_code)
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
        INSERT INTO Student_Master (
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
                UPDATE Student_Master SET
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

app.listen(3002, () => {
  console.log(`Server running on port  http://localhost:3002`);
});
