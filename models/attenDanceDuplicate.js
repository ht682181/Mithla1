const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const Student = require("./studentData.js");



const AttendenceDuplicateSchema = new Schema(
  {
    // Date ko STRING format ("YYYY-MM-DD") mein rakha hai taaki UTC Timezone bugs na aayein
    date: { type: String, required: true },       
    class: { type: String, required: true },      
    section: { type: String, required: true },    
    semester: { type: String, required: true },   
    periods: { type: Number, required: true },    
    subject: { type: String, required: true },    

    createdAt: { 
      type: Date, 
      default: Date.now 
    }, // Auto-delete after 8 hours (28800s)

    teacherId: { type: String },
    teacherName: { type: String },
    
    students: [
      {
        studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
        status: String,
        unit: String,
        description: String,
      }
    ]
  },
  { timestamps: true } // 🔥 Auto adds createdAt & updatedAt for safe tracking
);

// Auto-delete index (8 hours = 28800 seconds)
AttendenceDuplicateSchema.index({ createdAt: 1 }, { expireAfterSeconds: 28800 });

// ⚡ INDEX 1: PERIOD LOCK 
// Blocks duplicate period for same class today (Subject chahe jo bhi ho)
AttendenceDuplicateSchema.index(
  { date: 1, class: 1, section: 1, semester: 1, periods: 1 }, 
  { unique: true }
);

// ⚡ INDEX 2: SUBJECT LOCK 
// Blocks duplicate subject for same class today (Period chahe jo bhi ho)
AttendenceDuplicateSchema.index(
  { date: 1, class: 1, section: 1, semester: 1, subject: 1 }, 
  { unique: true }
);

const AttendenceDuplicate = mongoose.model("AttendenceDuplicate", AttendenceDuplicateSchema);
module.exports = AttendenceDuplicate;