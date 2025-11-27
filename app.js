require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
// const sql = require("mssql/msnodesqlv8");
const sql = require("mssql");
const cors = require("cors");
const cron = require("node-cron");

const app = express();
// const allowedOrigins = [
//   // "http://localhost:5173", // local dev
//   // "http://webenlighten.dpserp.com", // live frontend
//   "*"
// ];

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false, // must be false if origin is "*"
  })
);

app.use(express.json());

// Configure SQL Server connection
const sqlConfig = {
  // server: "HS-211-55211\\SQLEXPRESS", // Use 'server' instead of 'host' for mssql
  // database: "Enlighten_App",
  // user: "HS-211-55211\\sysadminhs",
  // options: {
  //   trustedConnection: true,
  //   encrypt: true,
  //   trustServerCertificate: true  // Needed for local development
  // },
  user: "sa",
  password: "DPSTECH@123",
  server: "168.220.237.211", // SQL Server address
  database: "Enlighten_App",
  options: {
    encrypt: false, // Set to true if using Azure
    enableArithAbort: true,
    multipleActiveResultSets: true,
  },
};

const dbConfig = {
  user: "sa",
  password: "DPSTECH@123",
  server: "168.220.237.211", // SQL Server address
  database: "Theme",
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
    const uploadDir = path.join(__dirname, "..", "uploads");

    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype !==
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      return cb(new Error("Only Excel files are allowed!"), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

let poolPromise = null;
async function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(sqlConfig)
      .connect()
      .then((pool) => {
        console.log("✅ Connected to MSSQL");
        return pool;
      })
      .catch((err) => {
        console.error("❌ Database Connection Failed -", err);
        poolPromise = null; // reset if failed
        throw err;
      });
  }
  return poolPromise;
}

// Convert everything → string (NVARCHAR)
function toText(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

let clients = [];

cron.schedule("0 0 * * *", async () => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      DELETE FROM [Assign_Master]
      WHERE DATEDIFF(DAY, created_date, GETDATE()) > 7
    `);
    console.log(
      `✅ Old assignments deleted. Rows affected: ${result.rowsAffected}`
    );
  } catch (err) {
    console.error("❌ Error deleting old assignments:", err);
  }
});

app.get("/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.push(res);

  req.on("close", () => {
    clients = clients.filter((c) => c !== res);
  });
});

function sendProgress(progress) {
  clients.forEach((res) => res.write(`data: ${progress}\n\n`));
}

app.post("/import-data", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "File is required.",
    });
  }

  const filePath = path.join(__dirname, "..", "uploads", req.file.filename);
  let transaction;

  try {
    // ⿡ Read Excel -> JSON
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheet]);

    if (!data || data.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: "Excel file is empty or invalid.",
      });
    }

    const pool = await getPool();
    transaction = new sql.Transaction(pool);
    await transaction.begin();
    const request = new sql.Request(transaction);

    // ✅ Improved Date Parser
    function parseDate(value) {
      if (!value) return null;

      // Excel serial number case
      if (typeof value === "number") {
        const excelEpoch = new Date(1900, 0, 1);
        const date = new Date(excelEpoch.getTime() + (value - 2) * 86400000);
        return new Date(date.getFullYear(), date.getMonth(), date.getDate()); // strip timezone
      }

      // String case (DD/MM/YYYY or DD-MM-YYYY)
      if (typeof value === "string") {
        const parts = value.split(/[\/\-]/);
        if (parts.length === 3) {
          const [d, m, y] = parts.map(Number);
          if (y && m && d) {
            return new Date(y, m - 1, d); // creates a local date (no UTC shift)
          }
        }
      }

      // Default fallback
      const date = new Date(value);
      return isNaN(date)
        ? null
        : new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    const total = data.length;
    let inserted = 0;

    for (const row of data) {
      if (!row.school_Id || !row.Scholarno || !row.StudentName) continue;

      const request = new sql.Request(transaction); // create NEW request per row

      await request
        .input("StudentName", sql.NVarChar, toText(row.StudentName))
        .input("StudentSurName", sql.NVarChar, toText(row.StudentSurName))
        .input("DOA", sql.NVarChar, toText(row.DOA))
        .input("DOB", sql.DateTime, parseDate(row.DOB))
        .input("Language", sql.NVarChar, toText(row.Language))
        .input("Sex", sql.NVarChar, toText(row.Sex))
        .input("PhoneNo", sql.NVarChar, toText(row.PhoneNo))
        .input("FatherName", sql.NVarChar, toText(row.FatherName))
        .input("FatherAddress", sql.NVarChar, toText(row.FatherAddress))
        .input("FatherPhone", sql.NVarChar, toText(row.FatherPhone))
        .input("FatherOccupation", sql.NVarChar, toText(row.FatherOccupation))
        .input("MotherName", sql.NVarChar, toText(row.MotherName))
        .input("MotherPhone", sql.NVarChar, toText(row.MotherPhone))
        .input("AppliedClass", sql.NVarChar, toText(row.AppliedClass))
        .input("AppliedStream", sql.NVarChar, toText(row.AppliedStream))
        .input("AppliedMedium", sql.NVarChar, toText(row.AppliedMedium))
        .input("SectionName", sql.NVarChar, toText(row.SectionName))
        .input("Area", sql.NVarChar, toText(row.Area))
        .input("Mode", sql.NVarChar, toText(row.Mode))
        .input("Board", sql.NVarChar, toText(row.Board))
        .input("CasteName", sql.NVarChar, toText(row.CasteName))
        .input("City", sql.NVarChar, toText(row.City))
        .input("Email", sql.NVarChar, toText(row.Email))
        .input(
          "created_date",
          sql.DateTime,
          parseDate(row.created_date) || new Date()
        )
        .input("type", sql.NVarChar, toText(row.type))
        .input("school_Id", sql.NVarChar, toText(row.school_Id))
        .input("school_code", sql.NVarChar, toText(row.school_code))
        .input("Scholarno", sql.NVarChar, toText(row.Scholarno))
        .input("img", sql.NVarChar, toText(row.img)).query(`
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
      const percent = Math.round((inserted / total) * 100);
      sendProgress(percent); // 🔥 send live progress
    }

    await transaction.commit(); // ✅ commit all inserts

    fs.unlinkSync(filePath);

    res.status(201).json({
      success: true,
      inserted,
      message: `Inserted ${inserted} student records`,
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error("Rollback failed:", error);
    console.error("❌ Import error:", error);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    try {
      if (transaction) await transaction.rollback(); // ❌ rollback on error
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr);
    }

    res.status(500).json({
      success: false,
      message: "Error importing data",
      error: error.message,
    });
  }
});

app.get("/download-import-data", async (req, res) => {
  try {
    const pool = await getPool(); // reuse your existing pool function

    // Fetch only required fields
    const result = await pool.request().query(`
      SELECT 
        StudentName, 
        StudentSurName, 
        FatherName, 
        FatherPhone, 
        school_Id, 
        school_code, 
        Scholarno,
        password,
        AppliedClass,
        AppliedStream,SectionName
      FROM Student_Master
    `);

    const students = result.recordset;

    if (!students || students.length === 0) {
      return res.status(404).send("No student data found");
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(students);

    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");

    const filePath = path.join(__dirname, "..", "uploads", "StudentData.xlsx");
    XLSX.writeFile(workbook, filePath);

    res.download(filePath, "StudentData.xlsx", (err) => {
      if (err) {
        console.error("Error sending file:", err);
        res.status(500).send("Error downloading file");
      }

      // Delete file after sending
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  } catch (error) {
    console.error("Error creating Excel file:", error);
    res.status(500).send("Error generating Excel file");
  }
});

app.get("/download-student-data/:school_code", async (req, res) => {
  const { school_code } = req.params;
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT * FROM Student_Master WHERE school_code = '${school_code}'
    `);

    const students = result.recordset;
    if (!students.length) return res.status(404).send("No student data found");

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(students);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");

    const fileName = `StudentData_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "..", "uploads", fileName);
    XLSX.writeFile(workbook, filePath);

    res.download(filePath, fileName, (err) => {
      if (err) return res.status(500).send("Error downloading file");
      fs.unlink(filePath, (e) => e && console.error(e));
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error generating student Excel file");
  }
});

app.get("/download-student-attendance/:school_code", async (req, res) => {
  const { school_code } = req.params;
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT * FROM Attendence_Master WHERE school_code = '${school_code}'
    `);

    const students = result.recordset;
    if (!students.length) return res.status(404).send("No student data found");

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(students);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");

    const fileName = `StudentData_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "..", "uploads", fileName);
    XLSX.writeFile(workbook, filePath);

    res.download(filePath, fileName, (err) => {
      if (err) return res.status(500).send("Error downloading file");
      fs.unlink(filePath, (e) => e && console.error(e));
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error generating student Excel file");
  }
});

app.get("/download-student-marks/:school_code", async (req, res) => {
  const { school_code } = req.params;
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT * FROM Marks_Master WHERE school_code = '${school_code}'
    `);

    const students = result.recordset;
    if (!students.length) return res.status(404).send("No student data found");

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(students);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");

    const fileName = `StudentData_${Date.now()}.xlsx`;
    const filePath = path.join(__dirname, "..", "uploads", fileName);
    XLSX.writeFile(workbook, filePath);

    res.download(filePath, fileName, (err) => {
      if (err) return res.status(500).send("Error downloading file");
      fs.unlink(filePath, (e) => e && console.error(e));
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error generating student Excel file");
  }
});

app.delete("/delete-student-marks/:school_code", async (req, res) => {
  const { school_code } = req.params;

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .query(`DELETE FROM Marks_Master WHERE school_code = '${school_code}'`);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).send("No marks found for the given school code");
    }

    res.status(200).send("Student marks deleted successfully");
  } catch (error) {
    console.error("Error deleting student marks:", error);
    res.status(500).send("Error deleting student marks");
  }
});

app.delete("/delete-school/:school_Id", async (req, res) => {
  const { school_Id } = req.params;

  if (!school_Id) {
    return res
      .status(400)
      .json({ success: false, message: "school_Id is required" });
  }

  let transaction;

  try {
    const pool = await getPool();
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const request = new sql.Request(transaction);

    // Example: delete from multiple tables where school_Id matches
    await request.query(
      `DELETE FROM User_Login WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Student_Master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM School_Master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Section_master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Admin_Notice WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Allotment_Master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Assign_Master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Attendence_Master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Class_Master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Exam_Calender WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Exam_type WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Holiday_Calender WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Marks_Master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Query_Master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Result_Publish WHERE school_Id = '${school_Id}'`
    );

    await request.query(
      `DELETE FROM Subject_Master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Teacher_Master WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Teacher_Notice WHERE school_Id = '${school_Id}'`
    );
    await request.query(
      `DELETE FROM Submit_Assign_Master WHERE school_Id = '${school_Id}'`
    );
    // Add more tables as needed

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: `All data for school_Id ${school_Id} has been deleted successfully from everywhere`,
    });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error("Error deleting school data:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting school data",
      error: error.message,
    });
  }
});

app.delete("/delete-teacher/:school_code/:teacher_Id", async (req, res) => {
  const { school_code, teacher_Id } = req.params;

  if (!school_code || !teacher_Id) {
    return res.status(400).json({
      success: false,
      message: "school_code and teacher_Id are required",
    });
  }

  let transaction;

  try {
    const pool = await getPool();
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const request = new sql.Request(transaction);

    // -------------------------------
    // 1️⃣ DELETE from User_Login
    // userId == teacher_Id
    // -------------------------------
    await request
      .input("school_code", sql.VarChar, school_code)
      .input("teacher_Id", sql.VarChar, teacher_Id).query(`
        DELETE FROM User_Login
        WHERE school_code = @school_code
        AND userId = @teacher_Id
      `);

    // -------------------------------
    // 2️⃣ DELETE from Teacher_Master
    // teacher_Id column exists here
    // -------------------------------
    await request.query(`
      DELETE FROM Teacher_Master
      WHERE school_code = @school_code
      AND teacher_Id = @teacher_Id
    `);

    await request.query(`
      DELETE FROM Allotment_Master
      WHERE school_code = @school_code
      AND teachers_id = @teacher_Id
    `);

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message:
        "Teacher deleted from Teacher_Master, User_Login And Allotment_Master successfully",
    });
  } catch (error) {
    if (transaction) await transaction.rollback();

    return res.status(500).json({
      success: false,
      message: "Error deleting teacher",
      error: error.message,
    });
  }
});

// app.put("/update-teacher/:school_code/:teacher_Id", async (req, res) => {
//   const { school_code, teacher_Id } = req.params;
//   const {
//     teacher_name,
//     gender,
//     mobile,
//     address,
//     class_name,
//     section_name
//   } = req.body;

//   if (!school_code || !teacher_Id) {
//     return res.status(400).json({
//       success: false,
//       message: "school_code and teacher_Id are required",
//     });
//   }

//   let transaction;

//   try {
//     const pool = await getPool();
//     transaction = new sql.Transaction(pool);
//     await transaction.begin();

//     const request = new sql.Request(transaction);

//     // 1️⃣ UPDATE User_Login TABLE
//     await request
//       .input("school_code", sql.VarChar, school_code)
//       .input("teacher_Id", sql.VarChar, teacher_Id)
//       .input("mobile", sql.VarChar, mobile)
//       .query(`
//         UPDATE User_Login
//         SET username = @mobile
//         WHERE school_code = @school_code
//         AND userId = @teacher_Id
//       `);

//     // 2️⃣ UPDATE Teacher_Master TABLE
//     await request
//       .input("teacher_name", sql.VarChar, teacher_name)
//       .input("gender", sql.VarChar, gender)
//       .input("mobile", sql.VarChar, mobile)
//       .input("address", sql.VarChar, address)
//       .input("class_name", sql.VarChar, class_name)
//       .input("section_name", sql.VarChar, section_name)
//       .input("school_code", sql.VarChar, school_code)
//       .input("teacher_Id", sql.VarChar, teacher_Id)
//       .query(`
//         UPDATE Teacher_Master
//         SET
//           teacher_name = @teacher_name,
//           gender = @gender,
//           mobile = @mobile,
//           address = @address,
//           class_name = @class_name,
//           section_name = @section_name
//         WHERE school_code = @school_code
//         AND teacher_Id = @teacher_Id
//       `);

//     await transaction.commit();

//     return res.status(200).json({
//       success: true,
//       message: "Teacher updated successfully in both tables",
//     });

//   } catch (error) {
//     if (transaction) await transaction.rollback();

//     return res.status(500).json({
//       success: false,
//       message: "Error updating teacher",
//       error: error.message,
//     });
//   }
// });

app.put("/update-teacher/:school_code/:teacher_Id", async (req, res) => {
  const { school_code, teacher_Id } = req.params;
  const {
    teacher_name,
    gender,
    mobile,
    address,
    class_name,
    class_id,
    section_name,
    section_id,
  } = req.body;

  if (!school_code || !teacher_Id) {
    return res.status(400).json({
      success: false,
      message: "school_code and teacher_Id are required",
    });
  }

  let transaction;

  try {
    const pool = await getPool();
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    // ----------------------------------------
    // 1️⃣ UPDATE User_Login (use new Request)
    // ----------------------------------------
    const request1 = new sql.Request(transaction);

    await request1
      .input("school_code", sql.VarChar, school_code)
      .input("teacher_Id", sql.VarChar, teacher_Id)
      .input("mobile", sql.VarChar, mobile).query(`
        UPDATE User_Login
        SET username = @mobile
        WHERE school_code = @school_code
        AND userId = @teacher_Id
      `);

    // ----------------------------------------
    // 2️⃣ UPDATE Teacher_Master (new Request)
    // ----------------------------------------
    const request2 = new sql.Request(transaction);

    await request2
      .input("teacher_name", sql.VarChar, teacher_name)
      .input("gender", sql.VarChar, gender)
      .input("mobile2", sql.VarChar, mobile)
      .input("address", sql.VarChar, address)
      .input("class_name", sql.VarChar, class_name)
      .input("class_id", sql.VarChar, class_id)
      .input("section_name", sql.VarChar, section_name)
      .input("section_id", sql.VarChar, section_id)
      .input("school_code", sql.VarChar, school_code)
      .input("teacher_Id", sql.VarChar, teacher_Id).query(`
        UPDATE Teacher_Master
        SET 
          teacher_name = @teacher_name,
          gender = @gender,
          mobile = @mobile2,
          address = @address,
          class_name = @class_name,
          class_id=@class_id,
          section_name = @section_name,
          section_id=@section_id

        WHERE school_code = @school_code
        AND teacher_Id = @teacher_Id
      `);

    const request3 = new sql.Request(transaction);

    await request3
      .input("teacher_name", sql.VarChar, teacher_name)
      .input("school_code", sql.VarChar, school_code)
      .input("teacher_Id", sql.VarChar, teacher_Id).query(`
        UPDATE Allotment_Master
        SET 
          teachers = @teacher_name
        WHERE school_code = @school_code
        AND teachers_id = @teacher_Id
      `);

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message:
        "Teacher updated successfully in Teacher_Master, User_Login And Allotment_Master tables",
    });
  } catch (error) {
    if (transaction) await transaction.rollback();

    return res.status(500).json({
      success: false,
      message: "Error updating teacher",
      error: error.message,
    });
  }
});

app.put("/update_student/:school_Id/:Scholarno", async (req, res) => {
  const { school_Id, Scholarno } = req.params;
  const { StudentName, password, img } = req.body;

  if (!school_Id || !Scholarno) {
    return res.status(400).json({
      success: false,
      message: "school_Id and Scholarno are required",
    });
  }

  try {
    const pool = await getPool();
    const request = pool.request();

    await request
      .input("StudentName", sql.NVarChar, StudentName)
      .input("school_Id", sql.NVarChar, school_Id)
      .input("password", sql.NVarChar, password)
      .input("Scholarno", sql.NVarChar, Scholarno)
      .input("img", sql.NVarChar, img).query(`
        UPDATE Student_Master
        SET 
          StudentName = @StudentName,
          password = @password,
          img = @img
        WHERE school_Id = @school_Id AND Scholarno = @Scholarno
      `);

    res.status(200).json({
      success: true,
      message: "Student updated successfully",
    });
  } catch (error) {
    console.error("Error updating student:", error);
    res.status(500).json({
      success: false,
      message: "Error updating student",
      error: error.message,
    });
  }
});

app.put("/update_teacher/:school_Id/:id", async (req, res) => {
  const { school_Id, id } = req.params;
  const { username, password, school_logo } = req.body;

  if (!school_Id || !id) {
    return res.status(400).json({
      success: false,
      message: "school_Id and id are required",
    });
  }

  try {
    const pool = await getPool();
    const request = pool.request();

    await request
      .input("username", sql.NVarChar, username)
      .input("school_Id", sql.NVarChar, school_Id)
      .input("password", sql.NVarChar, password)
      .input("id", sql.NVarChar, id)
      .input("school_logo", sql.NVarChar, school_logo).query(`
        UPDATE User_Login
        SET 
          username = @username,
          password = @password,
          school_logo = @school_logo
        WHERE school_Id = @school_Id AND id = @id
      `);

    res.status(200).json({
      success: true,
      message: "teacher updated successfully",
    });
  } catch (error) {
    console.error("Error updating teacher:", error);
    res.status(500).json({
      success: false,
      message: "Error updating student",
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
    StudentSurName,
    Sex,
    PhoneNo,
    FatherName,
    MotherName,
    DOA,
    DOB,
    FatherPhone,
    AppliedClass,
    SectionName,
    AppliedStream,
    AppliedMedium,
    Area,
    Mode,
    Board,
    CasteName,
    City,
    Email,
    created_date,
    type,
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

    const existingStudent = await pool
      .request()
      .input("Scholarno", sql.NVarChar(50), Scholarno)
      .input("school_code", sql.NVarChar(50), school_code).query(`
        SELECT 1 FROM Student_Master 
        WHERE Scholarno = @Scholarno AND school_code = @school_code
      `);

    if (existingStudent.recordset.length > 0) {
      return res.status(409).json({
        error: "Student with this ScholarNo and school code already exists",
      });
    }
    // Insert student record
    const result = await pool
      .request()
      .input("school_Id", sql.NVarChar(50), school_Id)
      .input("school_code", sql.NVarChar(50), school_code)
      .input("Scholarno", sql.NVarChar(50), Scholarno)
      .input("StudentName", sql.NVarChar(100), StudentName)
      .input("StudentSurName", sql.NVarChar(100), StudentSurName)
      .input("Sex", sql.NVarChar(10), Sex)
      .input("PhoneNo", sql.NVarChar(15), PhoneNo || null)
      .input("FatherName", sql.NVarChar(100), FatherName || null)
      .input("MotherName", sql.NVarChar(100), MotherName || null)
      .input("DOA", sql.Date, DOA ? new Date(DOA) : null)
      .input("DOB", sql.Date, DOB ? new Date(DOB) : null)
      .input("FatherPhone", sql.NVarChar(15), FatherPhone || null)
      .input("AppliedClass", sql.NVarChar(20), AppliedClass)
      .input("SectionName", sql.NVarChar(20), SectionName || null)
      .input("AppliedStream", sql.NVarChar(20), AppliedStream)
      .input("AppliedMedium", sql.NVarChar(20), AppliedMedium)
      .input("Area", sql.NVarChar(50), Area)
      .input("Mode", sql.NVarChar(50), Mode)
      .input("Board", sql.NVarChar(50), Board)
      .input("CasteName", sql.NVarChar(50), CasteName)
      .input("City", sql.NVarChar(50), City)
      .input("Email", sql.NVarChar(50), Email)
      .input("created_date", sql.NVarChar(50), created_date)
      .input("type", sql.NVarChar(50), type)
      .input("FatherAddress", sql.NVarChar(200), FatherAddress || null).query(`
        INSERT INTO Student_Master (
          school_Id, school_code, Scholarno, StudentName, StudentSurName, Sex, PhoneNo, FatherName,
          MotherName, DOA, DOB, FatherPhone, AppliedClass, SectionName, AppliedStream, AppliedMedium, Area, Mode, Board, CasteName, City, Email, created_date, type, FatherAddress
        ) VALUES (
          @school_Id, @school_code, @Scholarno, @StudentName, @StudentSurName, @Sex, @PhoneNo, @FatherName,
          @MotherName, @DOA, @DOB, @FatherPhone, @AppliedClass, @SectionName, @AppliedStream, @AppliedMedium, @Area, @Mode, @Board, @CasteName, @City, @Email, @created_date, @type, @FatherAddress
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
    StudentSurName,
    Sex,
    PhoneNo,
    FatherName,
    MotherName,
    DOA,
    DOB,
    FatherPhone,
    AppliedClass,
    SectionName,
    AppliedStream,
    AppliedMedium,
    Area,
    Mode,
    Board,
    CasteName,
    City,
    Email,
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
      .input("StudentSurName", sql.NVarChar(100), StudentSurName)
      .input("Sex", sql.NVarChar(10), Sex)
      .input("PhoneNo", sql.NVarChar(15), PhoneNo || null)
      .input("FatherName", sql.NVarChar(100), FatherName || null)
      .input("MotherName", sql.NVarChar(100), MotherName || null)
      .input("DOA", sql.Date, DOA ? new Date(DOA) : null)
      .input("DOB", sql.Date, DOB ? new Date(DOB) : null)
      .input("FatherPhone", sql.NVarChar(15), FatherPhone || null)
      .input("AppliedClass", sql.NVarChar(20), AppliedClass)
      .input("SectionName", sql.NVarChar(20), SectionName || null)
      .input("AppliedStream", sql.NVarChar(20), AppliedStream)
      .input("AppliedMedium", sql.NVarChar(20), AppliedMedium)
      .input("Area", sql.NVarChar(50), Area)
      .input("Mode", sql.NVarChar(50), Mode)
      .input("Board", sql.NVarChar(50), Board)
      .input("CasteName", sql.NVarChar(50), CasteName)
      .input("City", sql.NVarChar(50), City)
      .input("Email", sql.NVarChar(50), Email)
      .input("FatherAddress", sql.NVarChar(200), FatherAddress || null).query(`
                UPDATE Student_Master SET
                    StudentName = @StudentName,
                    StudentSurName = @StudentSurName,
                    Sex = @Sex,
                    PhoneNo = @PhoneNo,
                    FatherName = @FatherName,
                    MotherName = @MotherName,
                    DOA = @DOA,
                    DOB = @DOB,
                    FatherPhone = @FatherPhone,
                    AppliedClass = @AppliedClass,
                    SectionName = @SectionName,
                    AppliedStream = @AppliedStream,
                    AppliedMedium = @AppliedMedium,
                    Area = @Area,
                    Mode = @Mode,
                    Board = @Board,
                    CasteName = @CasteName,
                    City = @City,
                    Email = @Email,
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

app.get("/api/v1/count", async (req, res) => {
  let pool;
  try {
    pool = await sql.connect(sqlConfig);

    const active = await pool.request().query(`
      SELECT
        COUNT(*) AS active_count
      FROM
        School_Master
      WHERE
        school_active = 'true';
    `);

    const inactive = await pool.request().query(`
      SELECT
        COUNT(*) AS inactive_count
      FROM
        School_Master 
      WHERE
        school_active = 'false';        
    `);

    const activeDetails = await pool.request().query(`
      SELECT * FROM School_Master WHERE school_active = 'true'; 
    `);

    const inactiveDetails = await pool.request().query(`
      SELECT * FROM School_Master WHERE school_active = 'false';
    `);

    return res.status(200).json({
      count: {
        active: active.recordset[0].active_count,
        inactive: inactive.recordset[0].inactive_count,
      },
      activeSchools: activeDetails.recordset,
      inactiveSchools: inactiveDetails.recordset,
    });
  } catch (error) {
    console.error("Error fetching school counts and details:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/v1/themes/:school_code", async (req, res) => {
  const { school_code } = req.params;
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool
      .request()
      .input("school_code", sql.VarChar, school_code)
      .query(
        "SELECT * FROM school_theme_settings WHERE school_code = @school_code"
      );

    if (result.recordset.length === 0) {
      res.status(404).send("School theme not found.");
    } else {
      res.json(result.recordset[0]);
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// POST a new setting
app.post("/api/v1/themes", async (req, res) => {
  const {
    school_code,
    background,
    primary_color,
    navigator_color,
    header,
    sidebar,
    body_font,
    sidebar_position,
  } = req.body;

  try {
    const pool = await sql.connect(dbConfig);
    await pool
      .request()
      .input("school_code", sql.VarChar, school_code)
      .input("background", sql.VarChar, background)
      .input("primary_color", sql.VarChar, primary_color)
      .input("navigator_color", sql.VarChar, navigator_color)
      .input("header", sql.VarChar, header)
      .input("sidebar", sql.VarChar, sidebar)
      .input("body_font", sql.VarChar, body_font)
      .input("sidebar_position", sql.VarChar, sidebar_position).query(`
        INSERT INTO school_theme_settings 
        (school_code, background, primary_color, navigator_color, header, sidebar, body_font, sidebar_position)
        VALUES (@school_code, @background, @primary_color, @navigator_color, @header, @sidebar, @body_font, @sidebar_position)
      `);
    res.status(201).send("Theme inserted successfully.");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// PUT (update) setting by school_code
app.put("/api/v1/themes/:school_code", async (req, res) => {
  const { school_code } = req.params;
  const {
    background,
    primary_color,
    navigator_color,
    header,
    sidebar,
    body_font,
    sidebar_position,
  } = req.body;

  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool
      .request()
      .input("school_code", sql.VarChar, school_code)
      .input("background", sql.VarChar, background)
      .input("primary_color", sql.VarChar, primary_color)
      .input("navigator_color", sql.VarChar, navigator_color)
      .input("header", sql.VarChar, header)
      .input("sidebar", sql.VarChar, sidebar)
      .input("body_font", sql.VarChar, body_font)
      .input("sidebar_position", sql.VarChar, sidebar_position).query(`
        UPDATE school_theme_settings
        SET background = @background,
            primary_color = @primary_color,
            navigator_color = @navigator_color,
            header = @header,
            sidebar = @sidebar,
            body_font = @body_font,
            sidebar_position = @sidebar_position,
            updated_at = GETDATE()
        WHERE school_code = @school_code
      `);

    if (result.rowsAffected[0] === 0) {
      res.status(404).send("School theme not found.");
    } else {
      res.send("Theme updated successfully.");
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// DELETE setting by school_code
app.delete("/api/v1/themes/:school_code", async (req, res) => {
  const { school_code } = req.params;

  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool
      .request()
      .input("school_code", sql.VarChar, school_code)
      .query(
        "DELETE FROM school_theme_settings WHERE school_code = @school_code"
      );

    if (result.rowsAffected[0] === 0) {
      res.status(404).send("School theme not found.");
    } else {
      res.send("Theme deleted successfully.");
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});


// GET Teacher + Login details by School Code (double join)
app.get("/getBySchoolCode/:school_code", async (req, res) => {
  const { school_code } = req.params;

  try {
    // const pool = await sql.connect(dbConfig);
    const pool = await getPool();

    const result = await pool.request()
      .input("school_code", sql.VarChar, school_code)
      .query(`
        SELECT 
          TM.teacher_name,
          TM.gender,
          TM.mobile,
          TM.school_Id,
          UL.username,
          UL.password,
          UL.id,
          UL.type,
          UL.school_name
         
        FROM Teacher_Master TM      
        INNER JOIN User_Login UL   
          ON TM.mobile = UL.username
        WHERE TM.school_code = @school_code
      `);

    res.status(200).json({
      success: true,
      count: result.recordset.length,
      data: result.recordset,
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});



app.get("/getAllAdminSchools", async (req, res) => {
  try {
    // const pool = await sql.connect(dbConfig);

    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT 
        userId,
        username,
        password,
        type,
        school_code,
        school_Id,
        created_date,
        id,
        school_name
      FROM User_Login
      WHERE type = 'ADMIN'
    `);

    res.status(200).json({
      success: true,
      count: result.recordset.length,
      data: result.recordset
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
});

process.on("SIGINT", async () => {
  await pool.close();
  process.exit();
});

app.listen(3002, () => {
  console.log("Server running on port  http://localhost:3002");
});
