/**
 * ==========================================================
 * services/indexInverse.js
 * ANOR V14
 * Gestion des structures d'index inversé en mémoire (prefix16, prefix24, sha256)
 * ==========================================================
 */

class IndexInverse {

    constructor() {
        this.prefix16 = new Map(); // Map<string, Array>
        this.prefix24 = new Map(); // Map<string, Array>
        this.sha256 = new Map();   // Map<string, Object>
    }

    /**
     * Ajoute un produit/sceau dans les index inversés
     * @param {Map} map - La map cible (prefix16 ou prefix24)
     * @param {string} cle - La clé de préfixe
     * @param {Object} produit - L'objet produit certifié
     */
    ajouter(map, cle, produit) {
        if (!cle) return;
        if (!map.has(cle)) {
            map.set(cle, []);
        }
        const liste = map.get(cle);
        if (!liste.some(p => p.nonce === produit.nonce)) {
            liste.push(produit);
        }
    }

    /**
     * Recherche intelligente par niveau de précision décroissant
     * @param {Object} indexGeometrique - Objet contenant sha256, prefix24, prefix16
     * @returns {Array} Liste des candidats correspondants
     */
    rechercher(indexGeometrique) {
        if (!indexGeometrique) return [];

        if (indexGeometrique.sha256 && this.sha256.has(indexGeometrique.sha256)) {
            return [this.sha256.get(indexGeometrique.sha256)];
        }

        if (indexGeometrique.prefix24 && this.prefix24.has(indexGeometrique.prefix24)) {
            return this.prefix24.get(indexGeometrique.prefix24);
        }

        if (indexGeometrique.prefix16 && this.prefix16.has(indexGeometrique.prefix16)) {
            return this.prefix16.get(indexGeometrique.prefix16);
        }

        return [];
    }

    vider() {
        this.prefix16.clear();
        this.prefix24.clear();
        this.sha256.clear();
    }
}

module.exports = IndexInverse;