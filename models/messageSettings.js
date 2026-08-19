// const mongoose = require("mongoose");
// const Schema = mongoose.Schema;

// /**
//  * Singleton-style settings document (sirf ek document rahega DB me).
//  * Admin isse control karega ki Student ko reply karne ki permission hai ya nahi.
//  */
// const messageSettingsSchema = new Schema(
//   {
//     key: { type: String, default: "global", unique: true }, // singleton lock
//     allowStudentReply: { type: Boolean, default: true },
//     allowTeacherReply: { type: Boolean, default: true }, // future-proofing, admin ise bhi control kar sake
//   },
//   { timestamps: true }
// );

// messageSettingsSchema.statics.getSettings = async function () {
//   let settings = await this.findOne({ key: "global" });
//   if (!settings) {
//     settings = await this.create({ key: "global" });
//   }
//   return settings;
// };

// module.exports = mongoose.model("MessageSettings", messageSettingsSchema);


const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * Singleton Settings Schema
 * Controls three distinct reply directions across the application.
 */
const messageSettingsSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },
    allowStudentToAdminReply: { type: Boolean, default: true },
    allowStudentToTeacherReply: { type: Boolean, default: true },
    allowTeacherToAdminReply: { type: Boolean, default: true },
  },
  { timestamps: true }
);

messageSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne({ key: "global" });
  if (!settings) {
    settings = await this.create({ key: "global" });
  }
  return settings;
};

module.exports = mongoose.model("MessageSettings", messageSettingsSchema);