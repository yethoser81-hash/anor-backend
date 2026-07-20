/**
 * ==========================================================
 * services/cacheSignature.js
 * ANOR V14
 * Cache mémoire des résultats de comparaison pour optimiser les performances
 * ==========================================================
 */

class CacheSignature {

    constructor(maxSize = 1000) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    /**
     * Récupère un résultat en cache pour une empreinte donnée
     * @param {string} sha256 - Empreinte géométrique du sceau
     * @returns {Object|null} Résultat en cache ou null
     */
    get(sha256) {
        return this.cache.get(sha256) || null;
    }

    /**
     * Stocke un résultat de comparaison dans le cache
     * @param {string} sha256 - Empreinte géométrique du sceau
     * @param {Object} resultat - Résultat de la vérification
     */
    set(sha256, resultat) {
        if (this.cache.size >= this.maxSize) {
            // Suppression du premier élément entré (stratégie FIFO simple)
            const premierCle = this.cache.keys().next().value;
            this.cache.delete(premierCle);
        }
        this.cache.set(sha256, resultat);
    }

    /**
     * Vide le cache
     */
    vider() {
        this.cache.clear();
    }
}

module.exports = CacheSignature;