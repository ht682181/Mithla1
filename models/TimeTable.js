const mongoose = require('mongoose');

const timeTableSchema = new mongoose.Schema({
  day_of_week: { type: String, required: true }, // Mon, Tue, etc.
  lecture_number: { type: String, required: true }, // I, II, LUNCH, III, etc.
  start_time: { type: String, required: true }, // "08:30"
  end_time: { type: String, required: true }, // "09:25"
  className: { type: String, required: true },
  semester: { type: String, required: true },
  section: { type: String, required: true },
  
  // 🔥 REQUIRED HATAKAR CONDITIONAL VALIDATION LAGA DIYA
  teacher_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Teacher',
    required: function() { return this.lecture_number !== 'LUNCH'; } // Sirf regular class ke liye required
  },
  teacher_name: { type: String, default: "N/A" },
 
  subject_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject', // Apne Subject model ka exact name yaha rakhein
    required: function() { return this.lecture_number !== 'LUNCH'; }
  },
 
  subject_name: { 
    type: String, 
    required: function() { return this.lecture_number !== 'LUNCH'; } 
  }
});


// =================================================================
// 🚀 BUG 2 FIX: HIGH PERFORMANCE COMPOUND INDEXES
// Complex cross-table checks aur transaction locks fast karne ke liye
// =================================================================
timeTableSchema.index({ className: 1, semester: 1, section: 1, day_of_week: 1 });
timeTableSchema.index({ teacher_id: 1, day_of_week: 1 });
timeTableSchema.index({ className: 1, semester: 1, section: 1, lecture_number: 1, day_of_week: 1 });

module.exports = mongoose.model('TimeTable', timeTableSchema);