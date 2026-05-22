import mongoose from "mongoose";

const contactSchema = new mongoose.Schema(
  {
    githubLogin: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, default: "" },
    company: { type: String, default: "" },
    description: { type: String, default: "" },
    email: { type: String, default: "" },
    /** User-edited address book entries (primary email is also in `email`) */
    allEmails: { type: [String], default: [] },
    location: { type: String, default: "" },
    country: { type: String, default: "" },
    githubUrl: { type: String, default: "" },
    avatarUrl: { type: String, default: "" },
    website: { type: String, default: "" },
    emailSource: { type: String, default: "" },
    totalContributions: { type: Number, default: 0 },
    publicContributions: { type: Number, default: 0 },
    /** Operator machine IP when archived — used to filter My List per user */
    ownerIp: { type: String, default: "" },
    /** Unique display IP per GitHub login (derived, stable per contact) */
    contactIp: { type: String, default: "" },
    /** @deprecated legacy field; migrated to contactIp / ownerIp */
    savedIp: { type: String, default: "" },
    emailsSentCount: { type: Number, default: 0, min: 0 },
    /** Outreach — pending | queued | sent | read (recipient viewed) */
    outreachStatus: {
      type: String,
      enum: ["pending", "queued", "sent", "read"],
      default: "pending",
    },
    emailReadAt: { type: Date, default: null },
    addedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "contacts" }
);

contactSchema.index({ githubLogin: 1 }, { unique: true });
contactSchema.index({ email: 1 });
contactSchema.index({ addedAt: -1 });
contactSchema.index({ ownerIp: 1, addedAt: -1 });

contactSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export const Contact = mongoose.model("Contact", contactSchema);
