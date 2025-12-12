// String Crypto-js encryption and decryption
// Encrypt function
// function CryptoAESencrypt(text,secretKey) {
//     return CryptoJS.AES.encrypt(text, secretKey).toString();
// }

// // Decrypt function
// function CryptoAESdecrypt(cipherText,secretKey) {
//     try {
//         const bytes = CryptoJS.AES.decrypt(cipherText, secretKey);
//         return bytes.toString(CryptoJS.enc.Utf8);
//     } catch (error) {
//         console.error("Error during decryption:", error);
//         return "error";  // Or return a custom error message
//     }
// }

// assets/js/functions.js
// Crypto helpers
// AES Encryption

window.CryptoAESencrypt = function (text, secretKey) {
    return CryptoJS.AES.encrypt(text, secretKey).toString();
};

// AES Decryption
window.CryptoAESdecrypt = function (cipherText, secretKey) {
    try {
        const bytes = CryptoJS.AES.decrypt(cipherText, secretKey);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
        console.error("❌ Error during decryption:", error);
        return "";
    }
};

// Initialize global variables
window.initializeGlobals = async function () {
    try {
        // Wait for secureAPI to return the generated secret key
        window.secret_gen_key = await window.secureAPI.getSecretKey();

        // Get secret key from input element (if present)
        const input = document.getElementById("secret_key");
        if (input) window.secret_key = input.value;

        // Decrypt the API URL only if both keys exist
        if (window.secret_key && window.secret_gen_key) {
            window.apiUrl = window.CryptoAESdecrypt(window.secret_key, window.secret_gen_key);
            console.log("🔓 Decrypted API URL:", window.apiUrl);
        } else {
            console.warn("⚠️ Secret key or generated key missing.");
        }
    } catch (err) {
        console.error("❌ Failed to initialize globals:", err);
    }
};


// Function to handle login
async function login(username, password, apiUrl) {
    try {
        // Validate input
        if (username == "" || username == null) {
            throw new Error("Username is required.");
        }
        if (password == "" || password == null) {
            throw new Error("Password is required.");
        }

        // Prepare request payload
        const payload = {
            email_id: username.trim(),
            user_password: password.trim(),
        };

        // Make the POST request
        const response = await fetch(apiUrl+"/api/authlogin", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        // Handle response
        if (!response.ok) {
            const errorDetails = await response.json();
            throw new Error(`Login failed: ${errorDetails.message || response.statusText}`);
        }
        const data = await response.json();
        return data; // You can return the data for further processing
    } catch (error) {
        throw error;
    }
}

function showValidation(message, type = 'info', duration = 5000) {
    const box = document.getElementById('validationBox');
    if (!box) return;

    // Clear previous timer if any
    if (box._timeout) {
        clearTimeout(box._timeout);
        box._timeout = null;
    }

    // Reset class and set new message
    box.className = `validation-box ${type}`;
    box.textContent = message;
    box.style.display = 'block';

    // Only auto-hide if duration > 0
    if (duration > 0) {
        box._timeout = setTimeout(() => {
            box.style.display = 'none';
        }, duration);
    }
}
//
function hideValidation() {
    validationBox.className = 'validation-box';
    validationBox.textContent = '';
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}





