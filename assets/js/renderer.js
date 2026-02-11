let secret_gen_key;

window.electronAPI.getSecretKey().then((data) => {
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
            token: secret_key,
            customer_data : response.customer_data,
            config_data : response.config_data,
            domain_data : response.domain_data,
            user_data : response.data,
            apiUrl:apiUrl
        });

        window.electronAPI.sendSyncData({
            customer_data : response.customer_data,
            domain_data : response.domain_data,
            config_data : response.config_data,
            user_data : response.data,
            apiUrl:apiUrl
        });


        let user_sync_data = {
            customer_id :response.customer_data.id,
            domain_id :response.domain_data.id,
            domain_name :response.domain_data.domain_name,
            user_id:response.data.id,
            apiUrl:apiUrl
        };

        const BASELINE_TS = Math.floor(new Date("1900-01-01T00:00:00Z").getTime() / 1000);

        // offset in minutes (negative for UTC+ zones)
        const offsetMinutes = new Date().getTimezoneOffset(); 
        // convert to seconds
        const offsetSeconds = offsetMinutes * 60;

        // convert UTC → local time
        const BASELINE_LOCAL = BASELINE_TS - offsetSeconds;

        await window.electronAPI.setSyncStatus(user_sync_data,1);

        const insertedTime = await window.electronAPI.insertSettingIfNotExists(
            user_sync_data,
            "last_sync_at",
            BASELINE_LOCAL
        );

        const insertedId = await window.electronAPI.insertSettingIfNotExists(
            user_sync_data,
            "last_sync_id",
            0
        );

        if (insertedTime) {
            await window.electronAPI.setSyncStatus(user_sync_data, "last_sync_at", BASELINE_LOCAL);    
        } else {
            console.log("ℹ️ sync cursor already exists");
        }

        if (insertedId) {
            await window.electronAPI.setSyncStatus(user_sync_data, "last_sync_id", 0);    
        } else {
            console.log("ℹ️ sync cursor already exists");
        }
        
        window.secureAPI.send('navigate', 'home');
        localStorage.setItem('secret_key', secret_key);
        localStorage.setItem('secret_gen_key', secret_gen_key);
        localStorage.setItem('apiUrl', apiUrl);
        localStorage.setItem('config_data', JSON.stringify(response.config_data));
        localStorage.setItem('domain_data', JSON.stringify(response.domain_data));
        localStorage.setItem('customer_data', JSON.stringify(response.customer_data));
        localStorage.setItem('user_data', JSON.stringify(response.data));
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('loginTime', Date.now()); // optional, for expiry handling
    } catch (error) {
        showValidation("Error: " + error.message, 'error');
        console.error("Authentication failed:", error);
    }
});
//  hh
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

// Run every 5 minutes
// setInterval(() => {
//     autoSync({ customer_id, domain_id }).catch(err => console.error("Auto sync error:", err));
// }, 300000);



