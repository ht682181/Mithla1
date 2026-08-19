const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const studentArchiveSchema = new Schema({
  // 🔗 Original student ID backup ke liye
  originalStudentId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  rollNo: { 
    type: Number, 
    required: true 
  },
  name: { 
    type: String, 
    required: true 
  },
  fatherName: { 
    type: String, 
    required: true 
  },
  class: { 
    type: String, 
    required: true 
  },
  session: { 
    type: String, 
    required: true 
  },
  semester: String,
  section: String,
  email: String,
  image: {
    url: String,
    filename: String
  },
  // 🎓 Status hamesha default "passout" rahega
  status: {
    type: String,
    default: "passout"
  },
  archivedAt: {
    type: Date,
    default: Date.now
  },
  passoutYear: {
    type: Number,
    default: () => new Date().getFullYear()
  }
});

module.exports = mongoose.model("StudentArchive", studentArchiveSchema);