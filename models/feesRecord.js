// const mongoose = require('mongoose');

// // Helper to round currency to strictly 2 decimal places
// const roundCurrency = (val) => Math.round((parseFloat(val) || 0 + Number.EPSILON) * 100) / 100;

// // ==========================================
// // 1. FEE LEDGER SCHEMA (Single Student Lifetime Ledger)
// // ==========================================
// const feeLedgerSchema = new mongoose.Schema({
//   student_id: { 
//     type: mongoose.Schema.Types.ObjectId, 
//     ref: 'Student', 
//     required: true, 
//     unique: true 
//   },
//   rollNumber: { type: String, required: true, unique: true, index: true },
//   studentName: { type: String, required: true, trim: true },
//   fatherName: { type: String, default: '', trim: true },
  
//   // ⚡ Session / Batch Track (e.g. "2026-2029")
//   session: { type: String, required: true, trim: true, index: true },

//   currentCourse: { 
//     type: String, 
//     required: true, 
//     uppercase: true, 
//     trim: true 
//   },
  
//   classesHistory: [
//     {
//       className: { type: String, required: true, trim: true }, 
//       section: { type: String, required: true, uppercase: true, trim: true },
//       academicYear: { type: Number, required: true } 
//     }
//   ],

//   status: { 
//     type: String, 
//     enum: ['Active', 'Left College'], 
//     default: 'Active',
//     index: true
//   },

//   semesters: [
//     {
//       semNumber: { type: Number, required: true, min: 1, max: 8 },
//       due_amount: { type: Number, default: 0, min: 0, set: roundCurrency },
//       amount_paid: { type: Number, default: 0, min: 0, set: roundCurrency },
//       penalty_amount: { type: Number, default: 0, min: 0, set: roundCurrency },
//       balance_pending: { type: Number, default: 0, set: roundCurrency }
//     }
//   ],

//   // Advance / Excess Funds Management
//   advance_balance: { type: Number, default: 0, min: 0, set: roundCurrency },

//   // Overall Financial Lifetime Trackers
//   total_course_fees: { type: Number, default: 0, min: 0, set: roundCurrency },
//   total_amount_paid: { type: Number, default: 0, min: 0, set: roundCurrency },
//   overall_pending_balance: { type: Number, default: 0, set: roundCurrency }
// }, { timestamps: true });

// // Compound Indexes for High-Speed Batch Searches & Filters
// feeLedgerSchema.index({ "classesHistory.className": 1, "classesHistory.section": 1, "classesHistory.academicYear": 1 });
// feeLedgerSchema.index({ session: 1, currentCourse: 1, status: 1 });
// feeLedgerSchema.index({ student_id: 1, status: 1 });


// // ==========================================
// // 2. FEE TRANSACTION SCHEMA (Receipt Passbook Logs)
// // ==========================================
// const feeTransactionSchema = new mongoose.Schema({
//   receiptNumber: { type: String, required: true, unique: true, index: true }, 
//   student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
//   rollNumber: { type: String, required: true, index: true },
//   studentName: { type: String, required: true },
//   fatherName: { type: String, default: 'N/A' },
//   semNumber: { type: Number, required: true, min: 1, max: 8 }, 
//   academicYear: { type: Number, required: true },
//   amountPaid: { type: Number, required: true, min: 0, set: roundCurrency }, 
//   isAdvanceLog: { type: Boolean, default: false }, 
  
//   paymentMode: { 
//     type: String, 
//     enum: ['Cash', 'UPI', 'Net Banking', 'Cheque', 'Wallet Adjust', 'Online', 'System Adjustment'], 
//     default: 'Cash',
//     required: true 
//   },

//   // 🔴 CRITICAL ADDITION FOR RECEIPT-LEDGER DYNAMIC ROLLBACK
//   status: {
//     type: String,
//     enum: ['ACTIVE', 'CANCELLED'],
//     default: 'ACTIVE',
//     index: true
//   },

//   // Structured Metadata breakdown for Audit Trail & Rollbacks
//   metadata: {
//     breakdown: [
//       {
//         semNumber: { type: Number, required: true },
//         amount: { type: Number, required: true, set: roundCurrency },
//         source: { 
//           type: String, 
//           enum: ['Liquid Cash', 'Wallet Adjustment', 'Advance Spillover Saved'],
//           required: true 
//         }
//       }
//     ],
//     walletAdvanceSubtracted: { type: Number, default: 0, set: roundCurrency },
//     retainedWalletAdvance: { type: Number, default: 0, set: roundCurrency },
//     cancellationReason: { type: String, default: '' },
//     cancelledAt: { type: Date },
//     cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
//   },

//   paymentDate: { type: Date, default: Date.now, index: true } 
// }, { timestamps: true });

// // Compound Indexes for Fast Reporting & Date-wise Audits
// feeTransactionSchema.index({ student_id: 1, status: 1, academicYear: 1 });
// feeTransactionSchema.index({ createdAt: -1, status: 1 });
// feeTransactionSchema.index({ paymentDate: -1, paymentMode: 1 });

// const FeeLedger = mongoose.model('FeeLedger', feeLedgerSchema);
// const FeeTransaction = mongoose.model('FeeTransaction', feeTransactionSchema);

// module.exports = { FeeLedger, FeeTransaction };

const mongoose = require('mongoose');

// Helper to round currency to strictly 2 decimal places
const roundCurrency = (val) => Math.round((parseFloat(val) || 0 + Number.EPSILON) * 100) / 100;

// ==========================================
// 1. FEE LEDGER SCHEMA
// ==========================================
const feeLedgerSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, unique: true },
  rollNumber: { type: String, required: true, unique: true, index: true },
  studentName: { type: String, required: true, trim: true },
  fatherName: { type: String, default: '', trim: true },
  session: { type: String, required: true, trim: true, index: true },
  currentCourse: { type: String, required: true, uppercase: true, trim: true },
  
  classesHistory: [
    {
      className: { type: String, required: true, trim: true }, 
      section: { type: String, required: true, uppercase: true, trim: true },
      academicYear: { type: Number, required: true } 
    }
  ],

  status: { type: String, enum: ['Active', 'Left College'], default: 'Active', index: true },

  semesters: [
    {
      semNumber: { type: Number, required: true, min: 1, max: 8 },
      due_amount: { type: Number, default: 0, min: 0, set: roundCurrency },
      amount_paid: { type: Number, default: 0, min: 0, set: roundCurrency },
      penalty_amount: { type: Number, default: 0, min: 0, set: roundCurrency },
      balance_pending: { type: Number, default: 0, set: roundCurrency }
    }
  ],

  advance_balance: { type: Number, default: 0, min: 0, set: roundCurrency },
  total_course_fees: { type: Number, default: 0, min: 0, set: roundCurrency },
  total_amount_paid: { type: Number, default: 0, min: 0, set: roundCurrency },
  overall_pending_balance: { type: Number, default: 0, set: roundCurrency }
}, { timestamps: true });

feeLedgerSchema.index({ "classesHistory.className": 1, "classesHistory.section": 1, "classesHistory.academicYear": 1 });
feeLedgerSchema.index({ session: 1, currentCourse: 1, status: 1 });
feeLedgerSchema.index({ student_id: 1, status: 1 });


// ==========================================
// 2. FEE TRANSACTION SCHEMA (Enhanced Audit)
// ==========================================
const feeTransactionSchema = new mongoose.Schema({
  receiptNumber: { type: String, required: true, unique: true, index: true }, 
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  rollNumber: { type: String, required: true, index: true },
  studentName: { type: String, required: true },
  fatherName: { type: String, default: 'N/A' },
  semNumber: { type: Number, required: true, min: 1, max: 8 }, 
  academicYear: { type: Number, required: true },
  amountPaid: { type: Number, required: true, min: 0, set: roundCurrency }, 
  isAdvanceLog: { type: Boolean, default: false }, 
  
  paymentMode: { 
    type: String, 
    enum: ['Cash', 'UPI', 'Net Banking', 'Cheque', 'Wallet Adjust', 'Online', 'System Adjustment'], 
    default: 'Cash',
    required: true 
  },

  status: {
    type: String,
    enum: ['ACTIVE', 'CANCELLED'],
    default: 'ACTIVE',
    index: true
  },

  // 🔒 AUDIT TRAIL & REASON FIELDS FOR EDITS & CANCELLATIONS
  editCount: { type: Number, default: 0, max: 2 },
  actionReason: { type: String, default: '' }, // Direct Reason Field
  
  metadata: {
    breakdown: [
      {
        semNumber: { type: Number, required: true },
        amount: { type: Number, required: true, set: roundCurrency },
        source: { type: String, enum: ['Liquid Cash', 'Wallet Adjustment', 'Advance Spillover Saved'], required: true }
      }
    ],
    walletAdvanceSubtracted: { type: Number, default: 0, set: roundCurrency },
    retainedWalletAdvance: { type: Number, default: 0, set: roundCurrency },
    
    // Audit History for Edits
    editLogs: [
      {
        editedAt: { type: Date, default: Date.now },
        previousAmount: { type: Number },
        newAmount: { type: Number },
        reason: { type: String, required: true }
      }
    ],

    cancellationReason: { type: String, default: '' },
    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },

  paymentDate: { type: Date, default: Date.now, index: true } 
}, { timestamps: true });

feeTransactionSchema.index({ student_id: 1, status: 1, academicYear: 1 });
feeTransactionSchema.index({ createdAt: -1, status: 1 });

const FeeLedger = mongoose.model('FeeLedger', feeLedgerSchema);
const FeeTransaction = mongoose.model('FeeTransaction', feeTransactionSchema);

module.exports = { FeeLedger, FeeTransaction };