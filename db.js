const { createRxDatabase, addRxPlugin } = require('rxdb');
const { getRxStorageLoki } = require('rxdb/plugins/storage-lokijs');
const LokiFsStructuredAdapter = require('lokijs/src/loki-fs-structured-adapter');
const { RxDBLeaderElectionPlugin } = require('rxdb/plugins/leader-election');

addRxPlugin(RxDBLeaderElectionPlugin);

const projectSchema = {
    title: 'project schema',
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 100 },
        name: { type: 'string' },
        customer: { type: 'string' },
        budget: { type: 'number' },
        isComplete: { type: 'boolean' },
        isArchived: { type: 'boolean' },
        archivedAt: { type: 'number' },
        completedAt: { type: 'number' },
        tasks: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    totalTime: { type: 'number' },
                    isRunning: { type: 'boolean' },
                    currentStartTime: { type: 'number' },
                    tags: { type: 'array', items: { type: 'string' } },
                    logs: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                start: { type: 'number' },
                                end: { type: 'number' }
                            }
                        }
                    },
                    notes: { type: 'string' }
                }
            }
        },
        notes: { type: 'string' },
        updatedAt: { type: 'number' }
    },
    required: ['id', 'name', 'updatedAt']
};

const customerSchema = {
    title: 'customer schema',
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 100 },
        name: { type: 'string' },
        contacts: { type: 'string' },
        allotment: { type: 'number' },
        updatedAt: { type: 'number' }
    },
    required: ['id', 'name', 'updatedAt']
};

const settingsSchema = {
    title: 'settings schema',
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 100 },
        syncServerUrl: { type: 'string' },
        syncToken: { type: 'string' },
        isSyncEnabled: { type: 'boolean' },
        updatedAt: { type: 'number' }
    },
    required: ['id', 'updatedAt']
};

let dbPromise = null;

async function getDatabase(storagePath = '') {
    if (!dbPromise) {
        const path = require('path');
        const dbName = storagePath ? path.join(storagePath, 'timenerddb') : 'timenerddb';
        
        dbPromise = createRxDatabase({
            name: dbName,
            storage: getRxStorageLoki({
                adapter: new LokiFsStructuredAdapter()
            })
        }).then(async (db) => {
            await db.addCollections({
                projects: { schema: projectSchema },
                customers: { schema: customerSchema },
                settings: { schema: settingsSchema }
            });
            return db;
        });
    }
    return dbPromise;
}

module.exports = { getDatabase };
