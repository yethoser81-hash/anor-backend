// worker.js - Gestionnaire de file d'attente en mémoire pour ANOR-CHECK

/**
 * Normalise la structure des payloads de télémétrie et de logs
 * pour garantir un format uniforme en base / Supabase.
 */
function normalizePayload(type, payload = {}) {
    const timestamp = new Date().toISOString();

    switch (type) {
        case 'telemetry':
            return {
                timestamp,
                event: payload.event || 'UNKNOWN_EVENT',
                source: payload.source || 'app_worker',
                metrics: payload.metrics || {},
                context: payload.context || {}
            };

        case 'supabase_log':
            return {
                timestamp,
                level: (payload.level || 'info').toLowerCase(),
                message: payload.message || '',
                details: payload.details || null,
                service: payload.service || 'anor-check-service'
            };

        default:
            return {
                timestamp,
                type,
                raw: payload
            };
    }
}

class TaskQueue {
    constructor(ttlMinutes = 30) {
        this.jobs = new Map();
        this.ttlMs = ttlMinutes * 60 * 1000;
        
        // Nettoyage périodique des vieux jobs pour éviter de surcharger la mémoire
        setInterval(() => this._cleanUpOldJobs(), 10 * 60 * 1000);
    }

    /**
     * Enregistre et exécute une tâche asynchrone (Télémétrie, Supabase Logs, etc.).
     * 
     * @param {string} jobId - Identifiant unique de la tâche.
     * @param {Function} taskFunction - Fonction asynchrone prenant le payload normalisé en argument.
     * @param {Object} options - Type de tâche ('telemetry' | 'supabase_log') et données associées.
     */
    addJob(jobId, taskFunction, options = { type: 'generic', payload: {} }) {
        const normalizedData = normalizePayload(options.type, options.payload);

        this.jobs.set(jobId, {
            jobId,
            type: options.type,
            status: 'processing',
            payload: normalizedData,
            result: null,
            error: null,
            createdAt: new Date()
        });

        // Exécution asynchrone non bloquante
        setImmediate(async () => {
            try {
                // Passe les données normalisées à la fonction de traitement
                const result = await taskFunction(normalizedData);

                this.jobs.set(jobId, {
                    ...this.jobs.get(jobId),
                    status: 'completed',
                    result: result || null,
                    completedAt: new Date()
                });

                console.log(`✅ [WORKER] [${options.type}] Tâche ${jobId} terminée.`);
            } catch (err) {
                console.error(`❌ [WORKER] [${options.type}] Échec de la tâche ${jobId}:`, err.message);

                this.jobs.set(jobId, {
                    ...this.jobs.get(jobId),
                    status: 'failed',
                    error: {
                        message: err.message,
                        stack: err.stack || null
                    },
                    failedAt: new Date()
                });
            }
        });
    }

    /**
     * Récupère l'état courant d'une tâche.
     */
    getJobStatus(jobId) {
        return this.jobs.get(jobId) || null;
    }

    /**
     * Nettoie les tâches terminées ou échouées qui dépassent le délai TTL.
     */
    _cleanUpOldJobs() {
        const now = Date.now();
        for (const [jobId, job] of this.jobs.entries()) {
            const finishedTime = job.completedAt || job.failedAt;
            if (finishedTime && (now - new Date(finishedTime).getTime() > this.ttlMs)) {
                this.jobs.delete(jobId);
            }
        }
    }
}

module.exports = new TaskQueue();