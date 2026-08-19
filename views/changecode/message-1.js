const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * MESSAGE MODEL — Sabhi role (Admin, Teacher, Student) ke beech messaging.
 *
 * LOGIC SUMMARY:
 * -------------------------------------------------------------------
 * audienceType: "all"        -> Sabhi students (koi filter nahi)          [only recipientRole=Student]
 * audienceType: "filter"     -> class + semester + section ke hisab se    [only recipientRole=Student]
 *                                Isse GROUPED dikhta hai eg "BCA 1 A"
 * audienceType: "individual" -> Ek specific Student / Teacher / Admin ko  [teeno possible — Admin tab jab
 *                                                                          koi teacher/student use REPLY karta hai]
 *
 * NOTE (Teacher ko bulk bhejna): Admin jab ek saath multiple teachers ko
 * message bhejta hai, backend har teacher ke liye ALAG document banayega
 * (audienceType: "individual" har teacher ke liye) — is wajah se teacher
 * side par bulk grouped nahi dikhega, har teacher ka message alag-alag
 * dikhega (jaisa requirement tha).
 *
 * NOTE (Reply): Reply hamesha audienceType:"individual", isReply:true,
 * parentMessage set hoke original sender ko WAPAS jaata hai. recipientRole
 * us case me "Admin" bhi ho sakta hai (jab Teacher/Student admin ko reply
 * kare) — isliye enum me "Admin" shamil hai.
 * -------------------------------------------------------------------
 */

const readReceiptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ["Admin", "Teacher", "Student"], required: true },
    readAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    // ============ SENDER ============
    sender: {
      id: { type: Schema.Types.ObjectId, required: true },
      role: {
        type: String,
        enum: ["Admin", "Teacher", "Student"],
        required: true,
      },
      name: { type: String, required: true },
    },

    // ============ RECIPIENT TARGETING ============
    // 🔴 BUG FIX: "Admin" tha hi nahi is enum me — jab Teacher ya Student
    // admin ke message ka REPLY karta hai to recipientRole="Admin" set hota
    // hai (parent.sender.role se copy hota hai). Bina iske Message.create()
    // ValidationError throw karta aur reply save hi nahi hota.
    recipientRole: {
      type: String,
      enum: ["Admin", "Teacher", "Student"], // must match mongoose.model() names exactly (for refPath)
      required: true,
    },

    audienceType: {
      type: String,
      enum: ["all", "filter", "individual"],
      required: true,
    },

    // filter sirf audienceType = "filter" ke liye use hota hai (Student targeting)
    filter: {
      class: { type: String, trim: true },
      semester: { type: String, trim: true },
      section: { type: String, trim: true },
    },

    // sirf audienceType = "individual" ke liye
    recipientId: {
      type: Schema.Types.ObjectId,
      refPath: "recipientRole",
      default: null,
      index: true,
    },

    // Teacher jab student ko subject-wise bhejta hai (uske assigned subject ke against)
    subjectContext: {
      subjectId: { type: Schema.Types.ObjectId, ref: "Subject" },
      subjectName: String,
    },

    // ============ CONTENT ============
    content: {
      type: String,
      required: [true, "Message content is required"],
      trim: true,
      maxlength: [2000, "Message cannot exceed 2000 characters"],
    },

    // ============ THREADING / REPLY ============
    parentMessage: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
      index: true,
    },
    isReply: { type: Boolean, default: false },

    // ============ EDIT / DELETE (soft) ============
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    // ============ READ TRACKING ============
    readBy: { type: [readReceiptSchema], default: [] },
  },
  { timestamps: true }
);

// Fast lookups
messageSchema.index({ recipientRole: 1, audienceType: 1, "filter.class": 1, "filter.semester": 1, "filter.section": 1 });
messageSchema.index({ recipientRole: 1, recipientId: 1 });
messageSchema.index({ "sender.id": 1, "sender.role": 1 });
messageSchema.index({ createdAt: -1 });

// Helper: has a given user read this message?
messageSchema.methods.isReadBy = function (userId) {
  return this.readBy.some((r) => r.userId.toString() === userId.toString());
};

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;
