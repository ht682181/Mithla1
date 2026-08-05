const Joi = require("joi");
const ExpressError = require("../utils/ExpressError");

// 1️⃣ Setup Form Validation
const validateMarksSetup = (req, res, next) => {
  const schema = Joi.object({
    data: Joi.object({
      academicYear: Joi.string()
        .trim()
        .pattern(/^\d{4}-\d{2,4}$/)
        .required()
        .messages({
          "string.pattern.base": "Academic Year must be in format YYYY-YYYY (e.g. 2025-2028)",
          "any.required": "Academic Year is required"
        }),
      className: Joi.string().trim().required(),
      semester: Joi.number().integer().min(1).required(),
      section: Joi.string().trim().required(),
      subject: Joi.string().trim().required(),
      examName: Joi.string().trim().uppercase().required(), // Uppercase Rule
      examType: Joi.string().trim().required(),
      maxMarks: Joi.number().positive().required(),
      passMarks: Joi.number().min(0).required(),
      teacherName: Joi.string().trim().allow("").optional()
    }).required()
  });

  // 💡 FIX 1: 'value' extract kiya jisme Joi ka transformed (uppercase) data hota hai
  const { error, value } = schema.validate(req.body);
  if (error) {
    const msg = error.details.map((el) => el.message).join(", ");
    req.flash("error", `Validation Error: ${msg}`);
    return req.session.save(() => {
      res.redirect("/add/student-mark");
    });
  }

  // 💡 FIX 2: req.body ko updated Joi value se overwrite kar diya!
  req.body = value;
  next();
};

// 2️⃣ Save Marks Form Validation
const validateSaveMarks = (req, res, next) => {
  const schema = Joi.object({
    metaData: Joi.object({
      // academicYear: Joi.number().integer().required(),
      academicYear: Joi.string()
        .trim()
        .pattern(/^\d{4}-\d{2,4}$/)
        .required()
        .messages({
          "string.pattern.base": "Academic Year must be in format YYYY-YYYY (e.g. 2025-2028)",
          "any.required": "Academic Year is required"
        }),
      className: Joi.string().required(),
      semester: Joi.number().integer().required(),
      section: Joi.string().required(),
      subject: Joi.string().required(),
      examName: Joi.string().trim().uppercase().required(), // Uppercase Rule
      examType: Joi.string().required(),
      maxMarks: Joi.number().positive().required(),
      passMarks: Joi.number().min(0).required(),
      teacherName: Joi.string().allow("").optional()
    }).required(),
    studentMarks: Joi.object().pattern(
      Joi.string(), // Mongo ObjectId key
      Joi.object({
        rollNumber: Joi.string().optional(),
        studentName: Joi.string().optional(),
        fatherName: Joi.string().allow("").optional(),
        attendanceStatus: Joi.string().valid("Present", "Absent").required(),

        // Dynamic Check: Absent me blank/null allow karo, Present me required number
        obtainedMarks: Joi.when("attendanceStatus", {
          is: "Absent",
          then: Joi.number().min(0).allow("", null).optional(),
          otherwise: Joi.number().min(0).required()
        }),

        remarks: Joi.string().max(150).allow("").optional()
      })
    ).required()
  });

  // 💡 FIX 1: Extract 'value'
  const { error, value } = schema.validate(req.body);
  if (error) {
    const msg = error.details.map((el) => el.message).join(", ");
    req.flash("error", `Validation Failed: ${msg}`);
    return req.session.save(() => {
      res.redirect("/add/student-mark");
    });
  }

  // 💡 FIX 2: req.body ko overwrite kar diya
  req.body = value;

  // Cross-field validation: PassMarks <= MaxMarks
  if (Number(req.body.metaData.passMarks) > Number(req.body.metaData.maxMarks)) {
    req.flash("error", "Validation Error: Pass marks cannot exceed Maximum marks.");
    return req.session.save(() => {
      res.redirect("/add/student-mark");
    });
  }

  next();
};

module.exports = { validateMarksSetup, validateSaveMarks };