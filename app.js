require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
// const sql = require("mssql/msnodesqlv8");
const sql = require("mssql");
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



  const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    
    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      return cb(new Error('Only Excel files are allowed!'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// const upload = multer({ dest: "uploads/" });

// Example of connecting to the database

app.post("/import-data", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "File is required.",
    });
  }

  try {
    const filePath = path.join(__dirname, "..", "uploads", req.file.filename);
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheet]);

    const pool = await poolPromise;
    let inserted = 0;

    for (const row of data) {
      if (!row.school_Id || !row.Scholarno || !row.StudentName) continue;

      await pool
        .request()
        .input("StudentName", sql.NVarChar, row.StudentName)
        .input("StudentSurName", sql.NVarChar, row.StudentSurName)
        .input("DOA", sql.DateTime, row.DOA)
        .input("DOB", sql.DateTime, row.DOB)
        .input("Language", sql.NVarChar, row.Language)
        .input("Sex", sql.NVarChar, row.Sex)
        .input("PhoneNo", sql.NVarChar, row.PhoneNo)
        .input("FatherName", sql.NVarChar, row.FatherName)
        .input("FatherAddress", sql.NVarChar, row.FatherAddress)
        .input("FatherPhone", sql.NVarChar, row.FatherPhone)
        .input("FatherOccupation", sql.NVarChar, row.FatherOccupation)
        .input("MotherName", sql.NVarChar, row.MotherName)
        .input("MotherPhone", sql.NVarChar, row.MotherPhone)
        .input("AppliedClass", sql.NVarChar, row.AppliedClass)
        .input("AppliedStream", sql.NVarChar, row.AppliedStream)
        .input("AppliedMedium", sql.NVarChar, row.AppliedMedium)
        .input("SectionName", sql.NVarChar, row.SectionName)
        .input("Area", sql.NVarChar, row.Area)
        .input("Mode", sql.NVarChar, row.Mode)
        .input("Board", sql.NVarChar, row.Board)
        .input("CasteName", sql.NVarChar, row.CasteName)
        .input("City", sql.NVarChar, row.City)
        .input("Email", sql.NVarChar, row.Email)
        .input("created_date", sql.DateTime, row.created_date || new Date())
        .input("type", sql.NVarChar, row.type)
        .input("school_Id", sql.Int, row.school_Id)
        .input("school_code", sql.NVarChar, row.school_code)
        .input("Scholarno", sql.NVarChar, row.Scholarno)
        .input("img", sql.NVarChar, row.img).query(`
          INSERT INTO Student_Master (
            StudentName, StudentSurName, DOA, DOB, Language, Sex, PhoneNo,
            FatherName, FatherAddress, FatherPhone, FatherOccupation,
            MotherName, MotherPhone, AppliedClass, AppliedStream, AppliedMedium,
            SectionName, Area, Mode, Board, CasteName, City, Email,
            created_date, type, school_Id, school_code, Scholarno, img
          )
          VALUES (
            @StudentName, @StudentSurName, @DOA, @DOB, @Language, @Sex, @PhoneNo,
            @FatherName, @FatherAddress, @FatherPhone, @FatherOccupation,
            @MotherName, @MotherPhone, @AppliedClass, @AppliedStream, @AppliedMedium,
            @SectionName, @Area, @Mode, @Board, @CasteName, @City, @Email,
            @created_date, @type, @school_Id, @school_code, @Scholarno, @img
          )
        `);

      inserted++;
    }

    fs.unlinkSync(filePath);

    res.status(201).json({
      success: true,
      inserted,
      message: "Inserted ${inserted} student records.",
    });
  } catch (error) {
    console.error("❌ Import error:", error);
    res.status(500).json({
      success: false,
      message: "Error importing data",
      error: error.message,
    });
  }
});

app.post("/api/v1/students", async (req, res) => {
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
    FatherAddress,
  } = req.body;

  // Get schoolId from your system (could be from auth token, config, etc.)
  console.log(req.body, "xyz");
  // if (!Scholarno || !StudentName || !Sex || !Appliedclass || !SectionName) {
  //   return res.status(400).json({
  //     error: 'Scholarno, StudentName, Sex, AppliedClass, SectionName are required fields'
  //   });
  // }

  let pool;
  try {
    pool = await sql.connect(sqlConfig);

    // Insert student record
    const result = await pool
      .request()
      .input("school_Id", sql.NVarChar(50), school_Id)
      .input("school_code", sql.NVarChar(50), school_code)
      .input("Scholarno", sql.NVarChar(50), Scholarno)
      .input("StudentName", sql.NVarChar(100), StudentName)
      .input("Sex", sql.NVarChar(10), Sex)
      .input("FatherName", sql.NVarChar(100), FatherName || null)
      .input("MotherName", sql.NVarChar(100), MotherName || null)
      .input("DOB", sql.Date, DOB ? new Date(DOB) : null)
      .input("FatherPhone", sql.NVarChar(15), FatherPhone || null)
      .input("AppliedClass", sql.NVarChar(20), AppliedClass)
      .input("SectionName", sql.NVarChar(20), SectionName || null)
      .input("FatherAddress", sql.NVarChar(200), FatherAddress || null).query(`
        INSERT INTO Student_Master (
          school_Id, school_code, Scholarno, StudentName, Sex, FatherName,
          MotherName, DOB, FatherPhone, AppliedClass, SectionName, FatherAddress
        ) VALUES (
          @school_Id, @school_code, @Scholarno, @StudentName, @Sex, @FatherName,
          @MotherName, @DOB, @FatherPhone, @AppliedClass, @SectionName, @FatherAddress
        )
      `);

    return res.status(201).json({
      success: true,
      message: "Student record created successfully",
      Scholarno,
    });
  } catch (err) {
    console.error("Error inserting student:", err);

    if (err.number === 2627) {
      // SQL Server duplicate key error
      return res.status(409).json({
        error: "Student with this ScholarNo already exists",
      });
    }

    return res.status(500).json({
      error: "Failed to create student record",
      details: err.message,
    });
  } finally {
    if (pool) await pool.close();
  }
});

// PUT endpoint to update student data
app.put("/api/v1/updatestu", async (req, res) => {
  const {
    Scholarno,
    school_Id,
    StudentName,
    Sex,
    FatherName,
    MotherName,
    DOB,
    FatherPhone,
    AppliedClass,
    SectionName,
    FatherAddress,
  } = req.body;

  console.log(req.body);
  // Validate required fields
  if (!school_Id || !StudentName || !Sex || !AppliedClass || !SectionName) {
    return res.status(400).json({
      error:
        "school_Id, StudentName, Sex, AppliedClass, and SectionName are required fields",
    });
  }

  // Validate and parse date
  let dobDate = null;
  if (DOB) {
    dobDate = new Date(DOB);
    if (isNaN(dobDate.getTime())) {
      return res.status(400).json({
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }
  }

  let pool;
  try {
    pool = await sql.connect(sqlConfig);

    const result = await pool
      .request()
      .input("school_Id", sql.NVarChar(50), school_Id)
      .input("Scholarno", sql.NVarChar(50), Scholarno)
      .input("StudentName", sql.NVarChar(100), StudentName)
      .input("Sex", sql.NVarChar(10), Sex)
      .input("FatherName", sql.NVarChar(100), FatherName || null)
      .input("MotherName", sql.NVarChar(100), MotherName || null)
      .input("DOB", sql.Date, dobDate)
      .input("FatherPhone", sql.NVarChar(15), FatherPhone || null)
      .input("AppliedClass", sql.NVarChar(20), AppliedClass)
      .input("SectionName", sql.NVarChar(20), SectionName)
      .input("FatherAddress", sql.NVarChar(200), FatherAddress || null).query(`
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
                WHERE Scholarno = @Scholarno AND school_Id = @school_Id
            `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({
        error: "Student not found",
      });
    }

    return res.json({
      success: true,
      message: "Student updated successfully",
      Scholarno,
    });
  } catch (err) {
    console.error("Error updating student:", err);
    return res.status(500).json({
      error: "Failed to update student",
      details: err.message,
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
