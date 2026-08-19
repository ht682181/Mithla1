const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const replySchema = new Schema(
  {
    senderId: { type: Schema.Types.ObjectId, required: true },
    senderRole: { type: String, enum: ["Admin", "Teacher", "Student"], required: true },
    senderName: { type: String, required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const messageSchema = new Schema(
  {
    senderId: { type: Schema.Types.ObjectId, required: true },
    senderRole: { type: String, enum: ["Admin", "Teacher"], required: true },
    senderName: { type: String, required: true },
    
    recipientType: { type: String, enum: ["Student", "Teacher"], required: true },
    targetType: { type: String, enum: ["Bulk", "Individual"], required: true },
    
    // Student Filters (for Bulk / Target Context)
    className: { type: String, default: "" },
    semester: { type: String, default: "" },
    section: { type: String, default: "" },
    subjectName: { type: String, default: "" }, // Teacher -> Student filter
    
    // Individual Target Info
    recipientStudentId: { type: Schema.Types.ObjectId, ref: "Student", default: null },
    recipientTeacherId: { type: Schema.Types.ObjectId, ref: "Teacher", default: null },
    
    // Cached Display Details for Student Individual Messages
    studentDetails: {
      rollNo: { type: Number },
      name: { type: String },
      className: { type: String },
      semester: { type: String },
      section: { type: String },
    },

    messageText: { type: String, required: true },
    replies: [replySchema],

    // Admin Toggle Control for Student Reply Permission
    studentReplyAllowed: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);