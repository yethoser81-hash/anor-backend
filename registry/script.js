let globalRegistryData = [];

document.addEventListener("DOMContentLoaded", async () => {
    await verifierServeurEtChargerRegistre();
});

async function verifierServeurEtChargerRegistre() {
    const led = document.getElementById("serverLed");
    const label = document.getElementById("serverLabel");
    
    try {
        const res = await fetch('/health');
        if(res.ok) {
            led.style.backgroundColor = "#10b981";
            label.textContent = "Système en Ligne";
            chargerRegistreDonnees();
        } else {
            throw new Error();
        }
    } catch(e) {
        led.style.backgroundColor = "#ef4444";
        label.textContent = "Serveur Hors Ligne";
        document.getElementById("registryTableBody").innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--accent-red);">Connexion au serveur impossible.</td></tr>`;
    }
}

async function chargerRegistreDonnees() {
    try {
        const response = await fetch('/api/registry/data');
        const json = await response.json();
        if(json.success) {
            globalRegistryData = json.registry || [];
            afficherRegistre(globalRegistryData);
        }
    } catch (err) {
        console.error("Erreur de chargement du registre", err);
        document.getElementById("registryTableBody").innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--accent-red);">Erreur lors de la récupération des données du registre.</td></tr>`;
    }
}

function afficherRegistre(data) {
    const tbody = document.getElementById("registryTableBody");
    if(!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Aucun enregistrement trouvé.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map((item, index) => `
        <tr>
            <td><strong>${item.numero_lot}</strong></td>
            <td>${item.producteur}</td>
            <td>${item.produit}</td>
            <td>${item.quantite.toLocaleString()}</td>
            <td>${item.date_demande}</td>
            <td><span class="badge-cert">${item.statut}</span></td>
            <td><button class="btn-details" id="btn-details-${index}">Détails</button></td>
        </tr>
    `).join('');

    data.forEach((item, index) => {
        const btnDetails = document.getElementById(`btn-details-${index}`);
        if(btnDetails) {
            btnDetails.onclick = () => {
                ouvrirModalDetails(item);
            };
        }
    });
}

function ouvrirModalDetails(item) {
    const modal = document.getElementById("lotModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalDetailsText = document.getElementById("modalDetailsText");
    const modalProductImage = document.getElementById("modalProductImage");

    modalTitle.textContent = `Détails du Lot : ${item.numero_lot}`;
    
    // Image par défaut si aucune URL n'est présente dans les données
    modalProductImage.src = item.image_url || "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400";

    modalDetailsText.innerHTML = `
        <p><strong>Producteur :</strong> ${item.producteur}</p>
        <p><strong>Produit :</strong> ${item.produit}</p>
        <p><strong>Quantité :</strong> ${item.quantite.toLocaleString()} unités</p>
        <p><strong>Date d'émission :</strong> ${item.date_demande}</p>
        <p><strong>Statut :</strong> <span style="color: #10b981; font-weight: bold;">${item.statut}</span></p>
    `;

    modal.style.display = "flex";
}

function fermerModal() {
    const modal = document.getElementById("lotModal");
    if(modal) {
        modal.style.display = "none";
    }
}

// Fermer la modale en cliquant en dehors de celle-ci
window.onclick = function(event) {
    const modal = document.getElementById("lotModal");
    if (event.target === modal) {
        fermerModal();
    }
}

function filtrerRegistre() {
    const query = document.getElementById("registrySearch").value.toLowerCase();
    const status = document.getElementById("statusFilter").value;

    const filtered = globalRegistryData.filter(item => {
        const matchText = (item.numero_lot && item.numero_lot.toLowerCase().includes(query)) ||
                          (item.producteur && item.producteur.toLowerCase().includes(query)) ||
                          (item.produit && item.produit.toLowerCase().includes(query));
        const matchStatus = status === "" || item.statut === status;
        return matchText && matchStatus;
    });

    afficherRegistre(filtered);
}

function exporterRegistre() {
    alert("Génération de l'export sécurisé CSV du registre national en cours...");
}