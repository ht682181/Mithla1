const Joi = require("joi");
const ExpressError = require("../utils/ExpressError");

// 1️⃣ Update Student Marks Payload Validator
const validateUpdateMarks = (req, res, next) => {
  const schema = Joi.object({
    studentMarks: Joi.object().pattern(
      Joi.string(), // Student Mongo ObjectId
      Joi.object({
        attendanceStatus: Joi.string().valid("Present", "Absent").required(),

        // Dynamic Check: Absent me blank/null/missing allow karo, Present me required number
        obtainedMarks: Joi.when("attendanceStatus", {
          is: "Absent",
          then: Joi.number().min(0).allow("", null).optional(),
          otherwise: Joi.number().min(0).required()
        }),

        remarks: Joi.string().max(150).allow("").optional()
      })
    ).required()
  });

  // ✅ FIX: Extracting 'value' and overwriting req.body
  const { error, value } = schema.validate(req.body);
  if (error) {
    const msg = error.details.map((el) => el.message).join(", ");
    req.flash("error", `Validation Error: ${msg}`);
    return req.session.save(() => {
      res.redirect("back");
    });
  }

  req.body = value;
  next();
};

// 2️⃣ Update Exam Details Payload Validator
const validateUpdateExam = (req, res, next) => {
  const schema = Joi.object({
    subject: Joi.string().trim().required(),
    examName: Joi.string().trim().uppercase().required(), // Uppercase rule
    maxMarks: Joi.number().positive().required(),
    passMarks: Joi.number().min(0).required(),
    examType: Joi.string().valid("Theory", "Practical").required()
  });

  // ✅ FIX: Extracting 'value' (Holds the UPPERCASE examName)
  const { error, value } = schema.validate(req.body);
  if (error) {
    const msg = error.details.map((el) => el.message).join(", ");
    req.flash("error", `Validation Error: ${msg}`);
    return req.session.save(() => {
      res.redirect("back");
    });
  }

  // ✅ OVERWRITE req.body with transformed value
  req.body = value;

  // Cross-field validation: PassMarks <= MaxMarks
  if (Number(req.body.passMarks) > Number(req.body.maxMarks)) {
    req.flash("error", "Validation Error: Pass marks cannot be greater than Maximum marks.");
    return req.session.save(() => {
      res.redirect("back");
    });
  }

  next();
};

module.exports = { validateUpdateMarks, validateUpdateExam };