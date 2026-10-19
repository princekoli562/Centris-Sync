let secret_gen_key;
let savedSecretKey = null;

window.electronAPI.getSecretKey().then((data) => {
    secret_gen_key = data;
});

async function checkSavedSecretKey() {
    try {
        if (window.electronAPI && window.electronAPI.getSavedSecretKey) {
            const savedKey = await window.electronAPI.getSavedSecretKey();
            if (savedKey && typeof savedKey === 'string' && savedKey.trim() !== '') {
                savedSecretKey = savedKey.trim();
                const secretKeyInput = document.getElementById("secret_key");
                if (secretKeyInput) {
                    secretKeyInput.value = savedSecretKey;
                }
                const secretKeyGroup = document.getElementById("secretKeyGroup");
                if (secretKeyGroup) {
                    secretKeyGroup.style.display = "none";
                }
            } else {
                const secretKeyGroup = document.getElementById("secretKeyGroup");
                if (secretKeyGroup) {
                    secretKeyGroup.style.display = "block";
                }
            }
        }
    } catch (e) {
        console.error("Failed to check saved secret key:", e);
    } finally {
        setTimeout(focusAppropriateInput, 50);
    }
}

function initPasswordToggle() {
    const toggleBtn = document.getElementById("togglePasswordBtn");
    const pwdInput = document.getElementById("password");
    const icon = document.getElementById("togglePasswordIcon");

    if (toggleBtn && pwdInput) {
        toggleBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isPassword = pwdInput.type === "password";
            pwdInput.type = isPassword ? "text" : "password";
            if (icon) {
                icon.className = isPassword ? "fas fa-eye-slash" : "fas fa-eye";
            }
            toggleBtn.setAttribute("title", isPassword ? "Hide password" : "Show password");
            pwdInput.focus();
        });
    }
}

function focusAppropriateInput() {
    try {
        const usernameInput = document.getElementById("username");
        const passwordInput = document.getElementById("password");
        const secretKeyInput = document.getElementById("secret_key");

        [usernameInput, passwordInput, secretKeyInput].forEach(inp => {
            if (inp) {
                inp.removeAttribute("disabled");
                inp.removeAttribute("readonly");
                inp.style.pointerEvents = "auto";
            }
        });

        if (usernameInput) {
            usernameInput.focus();
        }
    } catch (err) {
        console.warn("focusAppropriateInput error:", err);
    }
}

function setupEnterKeySubmit() {
    ["secret_key", "username", "password"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("sync")?.click();
                }
            });
        }
    });
}

function initLoginPage() {
    initPasswordToggle();
    setupEnterKeySubmit();
    checkSavedSecretKey();
    setTimeout(() => {
        focusAppropriateInput();
    }, 80);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginPage);
} else {
    initLoginPage();
}

window.addEventListener("focus", () => {
    focusAppropriateInput();
});

// Explicitly handle click on inputs to ensure typing focus is immediately active
document.addEventListener("click", (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        e.target.focus();
    }
});

 // start authentication

const validationBox = document.getElementById('validationBox');
    
document.getElementById('sync').addEventListener('click', async () => {
    // get site url from secret key
    let secretKeyInput = document.getElementById("secret_key");
    let secret_key = secretKeyInput ? secretKeyInput.value.trim() : "";
    if (!secret_key && savedSecretKey) {
        secret_key = savedSecretKey;
        if (secretKeyInput) secretKeyInput.value = savedSecretKey;
    }
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

        // Save secret key to encrypted file at app.getPath('userData')
        if (window.electronAPI && window.electronAPI.saveSavedSecretKey) {
            await window.electronAPI.saveSavedSecretKey(secret_key);
        }

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

        const device_id = await window.electronAPI.getDeviceId(user_sync_data);

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



