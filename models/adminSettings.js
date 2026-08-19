const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const adminSettingsSchema = new Schema({
  studentReplyAllowed: { type: Boolean, default: true },
});

module.exports = mongoose.model("AdminSettings", adminSettingsSchema );