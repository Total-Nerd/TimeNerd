const mongoose = require('mongoose');

const SyncDataSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    collectionName: { type: String, required: true },
    documentId: { type: String, required: true },
    data: { type: Object, required: true },
    updatedAt: { type: Number, required: true, index: true },
    deleted: { type: Boolean, default: false }
});

SyncDataSchema.index({ userId: 1, collectionName: 1, documentId: 1 }, { unique: true });

module.exports = mongoose.model('SyncData', SyncDataSchema);
