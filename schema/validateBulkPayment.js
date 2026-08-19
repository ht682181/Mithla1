// const Joi = require('joi');

// const bulkPaymentSchema = Joi.object({
//   className: Joi.string().required(),
//   section: Joi.string().required(),
//   academicYear: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
//   modeSelection: Joi.string().valid('single', 'next', 'both').required(),
//   semA: Joi.number().integer().min(1).max(8).required(),
//   semB: Joi.number().integer().min(1).max(8).optional().allow(null, ''),
//   submitToken: Joi.string().required(),
//   payments: Joi.array().items(
//     Joi.object({
//       student_id: Joi.string().hex().length(24).required(),
//       rollNumber: Joi.string().required(),
//       studentName: Joi.string().required(),
//       status: Joi.string().valid('Active', 'Left College').required(),
//       amountToPay: Joi.number().min(0).required(),
//       paymentMode: Joi.string().valid('Cash', 'UPI', 'Net Banking', 'Cheque').required()
//     })
//   ).min(1).required()
// });

// const validateBulkPayments = (req, res, next) => {
//   const { error } = bulkPaymentSchema.validate(req.body);
//   if (error) {
//     req.flash("error", `⚠️ Joi Validation Error: ${error.details[0].message}`);
//     return res.redirect('/fees/collect-bulk');
//   }
//   next();
// };

// module.exports = validateBulkPayments;



const Joi = require('joi');
const ExpressError = require("../utils/ExpressError");


const bulkPaymentSchema = Joi.object({
  className: Joi.string().trim().required(),
  section: Joi.string().trim().required(),
  academicYear: Joi.alternatives().try(Joi.number(), Joi.string()).required(),
  modeSelection: Joi.string().valid('single', 'next', 'both').required(),
  semA: Joi.number().integer().min(1).max(8).required(),
  semB: Joi.alternatives().try(
    Joi.number().integer().min(1).max(8),
    Joi.string().allow('', null)
  ).optional(),
  submitToken: Joi.string().trim().required(),
  
  payments: Joi.array().items(
    Joi.object({
      student_id: Joi.string().hex().length(24).required(),
      rollNumber: Joi.string().trim().required(),
      studentName: Joi.string().trim().required(),
      status: Joi.string().valid('Active', 'Left College').required(),
      // Coerce String to Number seamlessly from form body inputs
      amountToPay: Joi.number().min(0).required(),
      paymentMode: Joi.string().valid('Cash', 'UPI', 'Net Banking', 'Cheque', 'Wallet Adjust', 'Online').default('Cash')
    })
  ).min(1).required()
});

const validateBulkPayments = (req, res, next) => {
  const { error } = bulkPaymentSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
  
  if (error) {
    const errorMessage = error.details.map(detail => detail.message).join(", ");
    req.flash("error", `⚠️ Input Validation Failure: ${errorMessage}`);
    
    // Redirect preserving critical search filters
    const { className, semA, section, academicYear, modeSelection } = req.body;
    return res.redirect(`/fees/collect-bulk?className=${encodeURIComponent(className || '')}&semester=${semA || ''}&section=${encodeURIComponent(section || '')}&academicYear=${academicYear || ''}&modeSelection=${modeSelection || ''}`);
  }
  
  next();
};

module.exports = validateBulkPayments;