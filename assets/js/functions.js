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


// 📦 Global initialization function
// window.initializeGlobals = async function () {
//     try {
//         // 1️⃣ Get secret key from preload (Electron)
//         window.secret_gen_key = await window.secureAPI.getSecretKey();
//         console.log("Loaded secret_gen_key:", window.secret_gen_key);

//         // 2️⃣ Get value from input if available (optional, e.g. on login page)
//         const keyInput = document.getElementById("secret_key");
//         if (keyInput) {
//             window.secret_key = keyInput.value;
//         }

//         // 3️⃣ Decrypt the URL
//         if (window.secret_key && window.secret_gen_key) {
//             window.apiUrl = CryptoAESdecrypt(window.secret_key, window.secret_gen_key);
//             console.log("Decrypted API URL:", window.apiUrl);
//         }

//     } catch (err) {
//         console.error("Error initializing globals:", err);
//     }
// };


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