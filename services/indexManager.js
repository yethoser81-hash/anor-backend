/**
 * ==========================================================
 * services/indexManager.js
 * ANOR V14
 * Gestionnaire global de l'index en mémoire (chargement et cache)
 * ==========================================================
 */

const IndexInverse = require("./indexInverse");

class IndexManager {

    constructor(supabaseClient) {
        this.supabase = supabaseClient;
        this.indexInverse = new IndexInverse();
    }

    /**
     * Charge l'ensemble des sceaux certifiés depuis Supabase vers les index en mémoire
     */
    async charger() {
        try {
            console.log("Chargement des sceaux certifiés depuis la base de données...");
            const { data, error } = await this.supabase
                .from("produit_certifie_anor")
                .select("*");

            if (error) {
                throw error;
            }

            this.indexInverse.vider();

            if (data && data.length > 0) {
                for (const produit of data) {
                    this.ajouter(produit);
                }
            }

            console.log(`Indexation en mémoire terminée : ${data ? data.length : 0} sceaux chargés.`);
        } catch (err) {
            console.error("Erreur lors du chargement de l'index en mémoire :", err.message);
        }
    }

    /**
     * Ajoute un produit dans l'index inverse en mémoire
     * @param {Object} produit - Objet du produit certifié
     */
    ajouter(produit) {
        if (!produit || !produit.index_geometrique) return;

        const idx = produit.index_geometrique;

        if (idx.prefix16) {
            this.indexInverse.ajouter(this.indexInverse.prefix16, idx.prefix16, produit);
        }
        if (idx.prefix24) {
            this.indexInverse.ajouter(this.indexInverse.prefix24, idx.prefix24, produit);
        }
        if (idx.sha256) {
            this.indexInverse.sha256.set(idx.sha256, produit);
        }
    }

    /**
     * Recherche un produit via l'index inversé
     * @param {Object} indexGeometrique - Objet index géométrique de la lecture
     * @returns {Array} Liste des candidats
     */
    rechercher(indexGeometrique) {
        return this.indexInverse.rechercher(indexGeometrique);
    }
}

module.exports = IndexManager;