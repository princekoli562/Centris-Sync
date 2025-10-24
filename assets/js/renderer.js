let secret_gen_key;

window.secureAPI.getSecretKey().then((data) => {
    secret_gen_key = data;
});

 // start authentication
    
document.getElementById('sync').addEventListener('click', async () => {
    // get site url from secret key
    let secret_key = document.getElementById("secret_key").value;
    var apiUrl = CryptoAESdecrypt(secret_key,secret_gen_key);
    if(apiUrl.length <= 0) {
        console.log("invalid secret key provided");
        return false;
    }
    let username = document.getElementById("username").value;
    let password = document.getElementById("password").value;
    // authenticate user
    login(username, password, apiUrl).then((response) => {
        // Notify the main process to navigate to the dashboard page
        try {
            window.secureAPI.send('navigate', 'home');
            localStorage.setItem('secret_key', secret_key);
            localStorage.setItem('secret_gen_key', secret_gen_key);
            localStorage.setItem('apiUrl', apiUrl);
            localStorage.setItem('domain_data', JSON.stringify(response.domain_data));
            localStorage.setItem('customer_data', JSON.stringify(response.customer_data));
            //alert(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('Error sending navigation request:', err);
        }
    })
    .catch((error) => {
        console.error("Authentication failed:", error.message);
    });
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



