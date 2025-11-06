let secret_gen_key;

window.secureAPI.getSecretKey().then((data) => {
    secret_gen_key = data;
});

 // start authentication

const validationBox = document.getElementById('validationBox');
    
document.getElementById('sync').addEventListener('click', async () => {
    // get site url from secret key
    let secret_key = document.getElementById("secret_key").value;
    var apiUrl = CryptoAESdecrypt(secret_key,secret_gen_key);
    if(apiUrl.length <= 0) {
       // console.log("invalid secret key provided");
        showValidation("Invalid secret key provided", 'error');
        return false;
    }
    let username = document.getElementById("username").value;
    let password = document.getElementById("password").value;
    // authenticate user
    try {
        const response = await login(username, password, apiUrl);

        if (response.status === 'error') {
            showValidation(response.message || "Authentication failed", 'error');
            return;
        }
        if (response.status === 'warning') {
            showValidation(response.message || "Please check your input", 'warning');
            return;
        }

        // Success
        showValidation("Login successful!", 'success');

        window.electronAPI.saveSession({
            user: username,
            token: secret_key
        });

        window.secureAPI.send('navigate', 'home');
        localStorage.setItem('secret_key', secret_key);
        localStorage.setItem('secret_gen_key', secret_gen_key);
        localStorage.setItem('apiUrl', apiUrl);
        localStorage.setItem('domain_data', JSON.stringify(response.domain_data));
        localStorage.setItem('customer_data', JSON.stringify(response.customer_data));
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('loginTime', Date.now()); // optional, for expiry handling
    } catch (error) {
        showValidation("Error: " + error.message, 'error');
        console.error("Authentication failed:", error);
    }
});

const tabs = document.querySelectorAll(".tab");
const contents = document.querySelectorAll(".tab-content");

tabs.forEach(tab => {
    tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    contents.forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
    });
});



