// String Crypto-js encryption and decryption
// Encrypt function
function CryptoAESencrypt(text,secretKey) {
    return CryptoJS.AES.encrypt(text, secretKey).toString();
}

// Decrypt function
function CryptoAESdecrypt(cipherText,secretKey) {
    try {
        const bytes = CryptoJS.AES.decrypt(cipherText, secretKey);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
        console.error("Error during decryption:", error);
        return "error";  // Or return a custom error message
    }
}

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