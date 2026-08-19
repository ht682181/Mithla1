const Joi = require("joi");

// String Sanitizer & HTML Stripper
const sanitizeString = (value, helpers) => {
  if (typeof value !== "string") return value;

  const cleaned = value
    .replace(/<[^>]*>?/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (!cleaned) return helpers.error("string.empty");
  return cleaned;
};

// Course Sanitizer (Removes Suffixes for HOD validation)
const sanitizeHodCourse = (value, helpers) => {
  if (typeof value !== "string") return value;

  let course = value
    .replace(/<[^>]*>?/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (!course) return helpers.error("string.empty");

  course = course
    .replace(/\s*[-_]?\s*(?:1ST|2ND|3RD|4TH|5TH|6TH|7TH|8TH)\s*(?:YEAR)?\s*$/i, "")
    .replace(/\s*[-_]?\s*(?:YEAR|SEM|SEMESTER)\s*\d+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!course) return helpers.error("string.empty");
  return course;
};

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

// Validate Class Incharge
const validateClassIncharge = (req, res, next) => {
  const schema = Joi.object({
    className: Joi.string()
      .custom(sanitizeString)
      .min(1)
      .max(80)
      .required()
      .messages({
        "string.empty": "Class Name cannot be empty.",
        "any.required": "Class Name is required.",
      }),

    semester: Joi.string()
      .custom(sanitizeString)
      .min(1)
      .max(30)
      .required()
      .messages({
        "string.empty": "Semester is required.",
        "any.required": "Semester is required.",
      }),

    sectionName: Joi.string()
      .custom(sanitizeString)
      .min(1)
      .max(30)
      .required()
      .messages({
        "string.empty": "Section Name is required.",
        "any.required": "Section Name is required.",
      }),

    teacherId: Joi.string()
      .trim()
      .pattern(objectIdPattern)
      .required()
      .messages({
        "string.empty": "Teacher selection is required.",
        "string.pattern.base": "Invalid Teacher ID selected.",
        "any.required": "Teacher selection is required.",
      }),
  });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const message = error.details.map((d) => d.message).join(" ");
    req.flash("error", message);
    return res.redirect("/admin/add/class/incharge");
  }

  req.body = value;
  next();
};

// Validate HOD
const validateHod = (req, res, next) => {
  const schema = Joi.object({
    courseName: Joi.string()
      .custom(sanitizeHodCourse)
      .min(1)
      .max(100)
      .required()
      .messages({
        "string.empty": "Course/Department Name is required.",
        "any.required": "Course/Department Name is required.",
      }),

    teacherId: Joi.string()
      .trim()
      .pattern(objectIdPattern)
      .required()
      .messages({
        "string.empty": "Teacher selection is required.",
        "string.pattern.base": "Invalid Teacher ID selected.",
        "any.required": "Teacher selection is required.",
      }),
  });

  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const message = error.details.map((d) => d.message).join(" ");
    req.flash("error", message);
    return res.redirect("/admin/add/class/incharge");
  }

  req.body = value;
  next();
};

module.exports = {
  validateClassIncharge,
  validateHod,
};