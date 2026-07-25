// worker.js - Gestionnaire de file d'attente en mémoire pour ANOR-CHECK

class TaskQueue {
    constructor() {
        this.jobs = new Map();
    }

    /**
     * Enregistre une nouvelle tâche et l'exécute immédiatement en tâche de fond.
     */
    addJob(jobId, taskFunction) {
        this.jobs.set(jobId, {
            status: 'processing',
            result: null,
            error: null,
            createdAt: new Date()
        });

        // Exécution asynchrone sans bloquer la boucle d'événements principale
        setImmediate(async () => {
            try {
                const result = await taskFunction();
                this.jobs.set(jobId, {
                    status: 'completed',
                    result: result,
                    error: null,
                    completedAt: new Date()
                });
                console.log(`✅ [WORKER] Tâche ${jobId} terminée avec succès.`);
            } catch (err) {
                console.error(`❌ [WORKER] Échec de la tâche ${jobId}:`, err.message);
                this.jobs.set(jobId, {
                    status: 'failed',
                    result: null,
                    error: err.message,
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
}

module.exports = new TaskQueue();