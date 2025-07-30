// main.js

// ตรวจสอบว่า web3.js ถูกโหลดแล้ว
if (typeof Web3 === 'undefined') {
  alert('Web3.js library not found. Please ensure it is loaded before this script.');
  console.error("Web3.js is not loaded. Check script tag order and path.");
}

// Global Variables
let web3;
let account;
let stakingContract;
let routerContract;
let usdtContract; 
let kjcContract;  
let kjcDecimals;  
let usdtDecimals; 

// ABIs & Addresses - As per your config.js
// These variables (stakingABI, contractAddress, usdtABI, usdtAddress, kjcAddress, routerAddress)
// are expected to be declared globally in your config.js file, loaded BEFORE main.js.

// ABI for PancakeSwap Router V2 (minimal, still needed here if not in config.js)
const ROUTER_ABI_MINIMAL = [
  {
    "inputs":[
      {"internalType":"uint256","name":"amountIn","type":"uint256"},
      {"internalType":"address[]","name":"path","type":"address[]"}
    ],
    "name":"getAmountsOut",
    "outputs":[{"internalType":"uint256[]","name":"","type":"uint256[]"}],
    "stateMutability":"view",
    "type":"function"
  }
];

// Minimal ABI for ERC20 tokens (for decimals, approve, allowance)
const ERC20_ABI_MINIMAL = [
  {"constant": true, "inputs": [], "name": "decimals", "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}], "payable": false, "stateMutability": "view", "type": "function"},
  {"constant": false, "inputs": [{"internalType": "address", "name": "spender", "type":"address"},{"internalType": "uint256", "name": "amount", "type":"uint256"}], "name": "approve", "outputs": [{"internalType": "bool", "name": "", "type":"bool"}], "payable": false, "stateMutability": "nonpayable", "type":"function"},
  {"constant": true, "inputs": [{"internalType": "address", "name": "owner", "type":"address"},{"internalType": "address", "name": "spender", "type":"address"}], "name": "allowance", "outputs": [{"internalType": "uint256", "name": "", "type":"uint256"}], "payable": false, "stateMutability": "view", "type":"function"}
];

// Chain ID for Binance Smart Chain Mainnet
const BSC_CHAIN_ID = '0x38';


// --- Helper Functions ---

async function getTokenDecimals(tokenContractInstance, fallbackDecimals = 18) {
    if (!tokenContractInstance) {
        console.warn("getTokenDecimals: Token contract instance not provided. Defaulting to", fallbackDecimals, "decimals.");
        return fallbackDecimals;
    }
    try {
        const decimals = await tokenContractInstance.methods.decimals().call();
        return parseInt(decimals);
    } catch (error) {
        console.error("getTokenDecimals: Failed to get token decimals from contract. Falling back to", fallbackDecimals, "decimals:", error);
        return fallbackDecimals;
    }
}

function displayWeiToToken(weiAmount, decimals) {
    if (!web3 || !weiAmount || typeof decimals === 'undefined' || isNaN(decimals)) return '0';
    try {
        const divisor = BigInt(10) ** BigInt(decimals);
        if (BigInt(weiAmount) === BigInt(0)) return '0'; 
        
        let amountStr = BigInt(weiAmount).toString();
        
        if (amountStr.length <= decimals) {
            amountStr = '0.' + '0'.repeat(decimals - amountStr.length) + amountStr;
        } else {
            amountStr = amountStr.slice(0, amountStr.length - decimals) + '.' + amountStr.slice(amountStr.length - decimals);
        }
        return amountStr.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');

    } catch (e) {
        console.error("displayWeiToToken: Error converting Wei to Token display:", e);
        return (parseFloat(weiAmount.toString()) / (10 ** decimals)).toString(); 
    }
}

function tokenToWei(tokenAmount, decimals) {
    if (!web3 || !tokenAmount || typeof decimals === 'undefined' || isNaN(decimals)) return '0';
    try {
        const [integer, fractional] = tokenAmount.toString().split('.');
        let weiAmount = BigInt(integer || '0') * (BigInt(10) ** BigInt(decimals));
        
        if (fractional) {
            if (fractional.length > decimals) {
                console.warn(`tokenToWei: Input fractional part '${fractional}' has more decimals than token (${decimals}). Truncating.`);
            }
            const paddedFractional = (fractional + '0'.repeat(decimals)).slice(0, decimals);
            weiAmount += BigInt(paddedFractional);
        }
        return weiAmount.toString();
    } catch (e) {
        console.error("tokenToWei: Error converting Token to Wei:", e);
        return web3.utils.toWei(tokenAmount.toString(), 'ether'); 
    }
}


// --- Main DApp Functions ---

async function connectWallet() {
  console.log("connectWallet: Function started.");
  // ตรวจสอบว่า MetaMask/wallet extension มีการติดตั้งหรือไม่
  if (typeof window.ethereum === 'undefined') {
    alert("กรุณาติดตั้ง MetaMask หรือ Bitget Wallet หรือเปิด DApp ผ่าน Browser ใน Wallet App");
    document.getElementById("walletAddress").innerText = `❌ ไม่พบ Wallet Extension`;
    console.error("connectWallet: window.ethereum is undefined. Wallet extension not detected.");
    return;
  }
  
  try {
    web3 = new Web3(window.ethereum); // สร้าง instance ของ Web3
    console.log("connectWallet: Web3 instance created.");

    // ขออนุญาตเชื่อมต่อบัญชี
    console.log("connectWallet: Requesting accounts...");
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    account = accounts[0]; // กำหนดบัญชีที่เชื่อมต่อ
    console.log("connectWallet: Connected account:", account);

    // ตรวจสอบ Chain ID ปัจจุบัน
    console.log("connectWallet: Getting current chain ID...");
    const currentChainId = await web3.eth.getChainId(); // ใช้ web3.eth.getChainId()
    const currentChainIdHex = web3.utils.toHex(currentChainId); // แปลงเป็น Hex
    console.log(`connectWallet: Current Chain ID (Hex): ${currentChainIdHex}, Expected: ${BSC_CHAIN_ID}`);

    if (currentChainIdHex !== BSC_CHAIN_ID) {
      console.warn(`connectWallet: Wrong network. Current: ${currentChainIdHex}, Expected: ${BSC_CHAIN_ID}. Attempting to switch.`);
      try {
        // พยายามสลับเครือข่ายไป BSC
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BSC_CHAIN_ID }],
        });
        console.log("connectWallet: Network switch requested.");
        // หลังจากสลับสำเร็จ, ดึงบัญชีอีกครั้ง (อาจไม่จำเป็นแต่เพิ่มความชัวร์)
        const newAccounts = await web3.eth.getAccounts();
        account = newAccounts[0];
        console.log("connectWallet: Switched to BSC. Connected account:", account);

      } catch (switchError) {
        // ถ้าสลับไม่ได้ (อาจจะยังไม่มี BSC ใน wallet)
        if (switchError.code === 4902) {
          console.log("connectWallet: BSC network not found in wallet. Attempting to add it.");
          try {
            // เพิ่ม Binance Smart Chain เข้าไปใน Wallet
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: BSC_CHAIN_ID,
                chainName: 'Binance Smart Chain Mainnet',
                nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                rpcUrls: ['https://bsc-dataseed.binance.org/'],
                blockExplorerUrls: ['https://bscscan.com/'],
              }],
            });
            console.log("connectWallet: BSC network add requested.");
            // หลังจากเพิ่มสำเร็จ, ดึงบัญชีอีกครั้ง
            const newAccounts = await web3.eth.getAccounts();
            account = newAccounts[0];
            console.log("connectWallet: BSC network added. Connected account:", account);

          } catch (addError) {
            console.error("connectWallet: Error adding BSC network:", addError);
            alert("❌ กรุณาเพิ่ม Binance Smart Chain ในกระเป๋าของคุณด้วยตนเอง");
            document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`;
            return;
          }
        } else {
          console.error("connectWallet: Error switching network:", switchError);
          alert("❌ กรุณาสลับไป Binance Smart Chain ด้วยตนเอง");
          document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`;
          return;
        }
      }
    }

    // อัปเดต UI ด้วยที่อยู่กระเป๋าที่เชื่อมต่อสำเร็จ
    document.getElementById("walletAddress").innerText = `✅ ${account}`;
    console.log("connectWallet: Wallet address updated in UI.");

    // --- Initializing Contracts ---
    console.log("connectWallet: Initializing contracts...");
    // **สำคัญมาก:** ตรวจสอบว่าตัวแปรเหล่านี้มาจาก config.js และมีค่าถูกต้อง
    if (typeof contractAddress === 'undefined' || typeof stakingABI === 'undefined' ||
        typeof usdtAddress === 'undefined' || typeof usdtABI === 'undefined' ||
        typeof kjcAddress === 'undefined' || typeof routerAddress === 'undefined') {
        console.error("connectWallet: Critical: One or more contract addresses/ABIs from config.js are undefined.");
        alert("❌ การตั้งค่า Contract ไม่สมบูรณ์ กรุณาตรวจสอบ config.js และลำดับการโหลด script.");
        document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`;
        return;
    }

    stakingContract = new web3.eth.Contract(stakingABI, contractAddress);
    routerContract = new web3.eth.Contract(ROUTER_ABI_MINIMAL, routerAddress); 
    usdtContract = new web3.eth.Contract(usdtABI, usdtAddress); 
    kjcContract = new web3.eth.Contract(ERC20_ABI_MINIMAL, kjcAddress); 
    console.log("connectWallet: Contracts initialized successfully.");

    usdtDecimals = await getTokenDecimals(usdtContract, 18);
    kjcDecimals = await getTokenDecimals(kjcContract, 18);
    console.log(`connectWallet: USDT Decimals: ${usdtDecimals}, KJC Decimals: ${kjcDecimals}`);


    generateReferralLink();
    loadStakingInfo();
    console.log("connectWallet: Connection successful and DApp functions called.");
  } catch (error) {
    console.error("❌ connectWallet: Uncaught error during connection process:", error);
    const errorMessage = getFriendlyErrorMessage(error);
    alert("❌ การเชื่อมต่อกระเป๋าล้มเหลว: " + errorMessage);
    document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`;
  }
}

function generateReferralLink() {
  if (!account) {
    document.getElementById("refLink").value = "โปรดเชื่อมต่อกระเป๋าเพื่อสร้างลิงก์";
    return;
  }
  const link = `${window.location.origin}${window.location.pathname}?ref=${account}`;
  document.getElementById("refLink").value = link;
}

function copyRefLink() {
  const input = document.getElementById("refLink");
  input.select();
  input.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(input.value);
  alert("✅ คัดลอกลิงก์เรียบร้อยแล้ว!");
}

function getReferrerFromURL() {
  // ตรวจสอบ web3 ก่อนใช้ web3.utils.isAddress
  if (web3 && web3.utils) { 
      const urlParams = new URLSearchParams(window.location.search);
      const ref = urlParams.get('ref');
      if (ref && web3.utils.isAddress(ref)) {
        document.getElementById("refAddress").value = ref;
      }
  } else {
      console.warn("getReferrerFromURL: web3 or web3.utils not available yet.");
  }
}

async function registerReferrer() {
  if (!stakingContract || !account) {
    alert("กรุณาเชื่อมกระเป๋าก่อน");
    return;
  }

  const ref = document.getElementById("refAddress").value;
  if (!web3.utils.isAddress(ref) || ref.toLowerCase() === account.toLowerCase()) {
    alert("❌ Referrer address ไม่ถูกต้อง หรือเป็น Address ของคุณเอง");
    return;
  }

  try {
    const txResponse = await stakingContract.methods.setReferrer(ref).send({ from: account });
    console.log("registerReferrer: Tx Hash:", txResponse.transactionHash);
    
    alert("กำลังรอการยืนยันการสมัคร Referrer... กรุณาตรวจสอบสถานะใน Wallet ของคุณ");

    const receipt = await web3.eth.getTransactionReceipt(txResponse.transactionHash);
    
    if (receipt && receipt.status) {
        alert("✅ สมัคร Referrer สำเร็จแล้ว!"); 
        console.log("registerReferrer: Confirmed:", receipt);
    } else {
        alert("❌ การสมัคร Referrer ไม่สำเร็จ หรือธุรกรรมถูกปฏิเสธ");
        console.error("registerReferrer: Failed or not confirmed:", receipt);
    }
    
  } catch (e) {
    console.error("registerReferrer: Error:", e);
    const errorMessage = getFriendlyErrorMessage(e);
    alert(`❌ เกิดข้อผิดพลาดในการสมัคร Referrer: ${errorMessage}`);
  }
}

async function buyToken() {
  if (!stakingContract || !account || !usdtContract || !routerContract || typeof usdtDecimals === 'undefined' || typeof kjcDecimals === 'undefined') {
    alert("⚠️ กำลังโหลดข้อมูล กรุณารอสักครู่แล้วลองใหม่");
    console.warn("buyToken: Contracts or decimals not initialized yet.");
    return;
  }

  const rawInput = document.getElementById("usdtAmount").value.trim();
  if (!rawInput || isNaN(rawInput) || parseFloat(rawInput) <= 0) {
    alert("❌ กรุณาใส่จำนวน USDT ที่จะใช้ซื้อให้ถูกต้อง (ต้องมากกว่า 0)");
    return;
  }

  const usdtAmountFloat = parseFloat(rawInput);
  const usdtInWei = tokenToWei(usdtAmountFloat, usdtDecimals);
  
  console.log(`buyToken: USDT Amount (User Input): ${usdtAmountFloat}`);
  console.log(`buyToken: USDT Amount (in Wei, based on ${usdtDecimals} decimals): ${usdtInWei}`);

  try {
    // ตรวจสอบความถูกต้องของ Address ก่อนใช้งาน
    if (!web3.utils.isAddress(usdtAddress) || !web3.utils.isAddress(kjcAddress)) {
        alert("❌ ที่อยู่ Token ไม่ถูกต้องใน config.js");
        console.error("buyToken: Invalid token addresses from config.js");
        return;
    }

    const path = [usdtAddress, kjcAddress];

    console.log("buyToken: Getting amounts out from router...");
    const amountsOut = await routerContract.methods.getAmountsOut(usdtInWei, path).call();
    const expectedKjcOutWei = BigInt(amountsOut[1]);
    console.log(`buyToken: Expected KJC from Router (raw Wei): ${expectedKjcOutWei.toString()}`);
    console.log(`buyToken: Expected KJC from Router (formatted): ${displayWeiToToken(expectedKjcOutWei, kjcDecimals)} KJC`);

    const SLIPPAGE_PERCENTAGE = 5;
    const minOut = expectedKjcOutWei * BigInt(100 - SLIPPAGE_PERCENTAGE) / 100n;
    console.log(`buyToken: Minimum KJC to receive (with ${SLIPPAGE_PERCENTAGE}% slippage): ${minOut.toString()} Wei`);
    console.log(`buyToken: Minimum KJC to receive (formatted): ${displayWeiToToken(minOut, kjcDecimals)} KJC`);

    console.log("buyToken: Checking current allowance...");
    const allowance = await usdtContract.methods.allowance(account, contractAddress).call();
    console.log(`buyToken: Current Allowance for Staking Contract: ${allowance.toString()} Wei`);

    if (BigInt(allowance) < BigInt(usdtInWei)) {
      console.log("buyToken: Allowance insufficient. Initiating approval...");
      const approveTx = await usdtContract.methods.approve(contractAddress, usdtInWei).send({ from: account });
      console.log("buyToken: Approve Transaction Hash:", approveTx.transactionHash);
      alert("✅ การอนุมัติ USDT สำเร็จแล้ว! กรุณากด 'ซื้อเหรียญ KJC' อีกครั้งเพื่อดำเนินการ Stake.");
      return; 
    } else {
      console.log("buyToken: Allowance is sufficient. Proceeding with buy and stake.");
    }

    console.log("buyToken: Initiating buyAndStake transaction...");
    const buyTx = await stakingContract.methods.buyAndStake(usdtInWei, minOut.toString()).send({ from: account });
    console.log("buyToken: Buy and Stake Transaction Hash:", buyTx.transactionHash);

    alert(`✅ ซื้อ ${usdtAmountFloat} USDT และ Stake สำเร็จ!`);
    loadStakingInfo();
  } catch (e) {
    console.error("buyToken: Error:", e);
    const errorMessage = getFriendlyErrorMessage(e);
    alert(`❌ เกิดข้อผิดพลาดในการซื้อเหรียญ: ${errorMessage}`);
  }
}

async function loadStakingInfo() {
  if (!stakingContract || !account || typeof kjcDecimals === 'undefined') {
      document.getElementById("stakeAmount").innerText = "⚠️ กำลังโหลดข้อมูล...";
      console.warn("loadStakingInfo: Contracts or decimals not initialized.");
      return;
  }
  try {
    const rawAmount = await stakingContract.methods.stakedAmount(account).call();
    const stakeTime = await stakingContract.methods.lastStakeTime(account).call();
    const duration = await stakingContract.methods.STAKE_DURATION().call();
    
    const display = displayWeiToToken(rawAmount, kjcDecimals);

    const depositDate = new Date(Number(stakeTime) * 1000);
    const endDate = new Date((Number(stakeTime) + Number(duration)) * 1000);
    const formatDate = (d) => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    document.getElementById("stakeAmount").innerHTML = `
      💰 จำนวน: ${display} KJC<br/>
      📅 ฝากเมื่อ: ${formatDate(depositDate)}<br/>
      ⏳ ครบกำหนด: ${formatDate(endDate)}
    `;
    console.log("loadStakingInfo: Staking info loaded successfully.");
  } catch (e) {
    console.error("loadStakingInfo: Error loading stake info:", e);
    document.getElementById("stakeAmount").innerText = "❌ โหลดไม่สำเร็จ: " + (e.message || "Unknown error");
  }
}

async function claimReward() {
  if (!stakingContract || !account) {
    document.getElementById("claimStatus").innerText = "⚠️ กรุณาเชื่อมกระเป๋าก่อน";
    return;
  }

  try {
    const lastClaimTime = await stakingContract.methods.lastClaim(account).call();
    const claimInterval = await stakingContract.methods.CLAIM_INTERVAL().call();
    const now = Math.floor(Date.now() / 1000);

    const nextClaimTime = Number(lastClaimTime) + Number(claimInterval);

    if (now >= nextClaimTime) {
      const tx = await stakingContract.methods.claimStakingReward().send({ from: account });
      console.log("claimReward: Tx Hash:", tx.transactionHash);
      alert("🎉 เคลมรางวัลสำเร็จแล้ว!");
      document.getElementById("claimStatus").innerText = "🎉 เคลมรางวัลสำเร็จแล้ว!";
      loadStakingInfo();
    } else {
      const remainingSeconds = nextClaimTime - now;
      const waitMinutes = Math.ceil(remainingSeconds / 60);
      const waitHours = Math.floor(waitMinutes / 60);
      const remainingMinutes = waitMinutes % 60;
      let waitString = "";
      if (waitHours > 0) waitString += `${waitHours} ชั่วโมง `;
      if (remainingMinutes > 0 || waitHours === 0) waitString += `${remainingMinutes} นาที`;
      document.getElementById("claimStatus").innerText = `⏳ ต้องรออีก ${waitString}`;
    }
  } catch (e) {
    console.error("claimReward: Error:", e);
    const errorMessage = getFriendlyErrorMessage(e);
    document.getElementById("claimStatus").innerText = `❌ เกิดข้อผิดพลาดในการเคลมรางวัล: ${errorMessage}`;
  }
}

function getFriendlyErrorMessage(error) {
    let errorMessage = "Unknown error occurred.";
    if (error.message) {
        errorMessage = error.message;
        if (errorMessage.includes("User denied transaction signature")) {
            errorMessage = "ผู้ใช้ยกเลิกธุรกรรม";
        } else if (errorMessage.includes("execution reverted")) {
            const revertReasonMatch = errorMessage.match(/revert: (.*?)(?=[,}]|$)/);
            if (revertReasonMatch && revertReasonMatch[1]) {
                errorMessage = `ธุรกรรมล้มเหลว: ${revertReasonMatch[1].trim()}`;
            } else {
                errorMessage = "ธุรกรรมล้มเหลวบน Smart Contract (อาจเกิดจาก Slippage หรือเงื่อนไขอื่นๆ)";
            }
        } else if (errorMessage.includes("gas required exceeds allowance")) {
            errorMessage = "Gas ไม่เพียงพอ หรือ Gas Limit ต่ำเกินไป";
        } else if (errorMessage.includes("insufficient funds for gas")) {
            errorMessage = "ยอด BNB ในกระเป๋าไม่พอสำหรับค่า Gas";
        } else if (errorMessage.includes("missing trie node")) {
            errorMessage = "ข้อมูลเครือข่ายไม่สมบูรณ์ กรุณาลองใหม่ หรือเปลี่ยน RPC Node ใน Wallet";
        } else if (errorMessage.includes("Transaction was not mined within 50 blocks")) {
            errorMessage = "ธุรกรรมรอนานเกินไป (อาจต้องเพิ่ม Gas Price หรือเครือข่ายหนาแน่น)";
        }
    } else if (error.code) {
        if (error.code === 4001) {
            errorMessage = "ผู้ใช้ยกเลิกธุรกรรม";
        } else if (error.code === -32000) {
            errorMessage = "RPC Error: " + (error.message || "โปรดลองใหม่ในภายหลัง");
        }
    }
    return errorMessage;
}

// Event Listeners (ตรวจสอบให้แน่ใจว่า ID ของปุ่มใน HTML ตรงกับที่นี่)
window.addEventListener('load', () => {
  console.log("Window loaded. Attaching event listeners.");
  getReferrerFromURL();
  
  // ใช้ querySelector และ Optional Chaining (?) เพื่อความปลอดภัย
  // และตรวจสอบให้แน่ใจว่า ID ของปุ่มตรงกับใน HTML ของคุณ
  // ตัวอย่าง: <button onclick="connectWallet()"> จะต้องเป็น <button id="connectWalletBtn"> ใน HTML
  // หรือคุณต้องเรียกฟังก์ชัน connectWallet() โดยตรง เช่น window.addEventListener('load', connectWallet);
  
  // จาก HTML ที่คุณให้มา, คุณใช้ onclick="..." โดยตรง
  // ดังนั้น listener เหล่านี้จะไม่ได้ทำงานเอง
  // แต่โค้ด onclick="..." ใน HTML ก็จะเรียกฟังก์ชันได้โดยตรงอยู่แล้ว
  // ผมจะยังคงชุดนี้ไว้เผื่อคุณเปลี่ยนมาใช้ id/addEventListener ในอนาคต
  document.querySelector('button[onclick="connectWallet()"]')
    ?.addEventListener('click', connectWallet);
  document.querySelector('button[onclick="copyRefLink()"]')
    ?.addEventListener('click', copyRefLink);
  document.querySelector('button[onclick="registerReferrer()"]')
    ?.addEventListener('click', registerReferrer);
  document.querySelector('button[onclick="buyToken()"]')
    ?.addEventListener('click', buyToken);
  document.querySelector('button[onclick="claimReward()"]')
    ?.addEventListener('click', claimReward);
  
  // หากต้องการให้ connectWallet ทำงานทันทีเมื่อหน้าเว็บโหลด โดยไม่ต้องกดปุ่ม
  // สามารถ Uncomment บรรทัดนี้ได้
  // connectWallet();
});

// Optional: Handle Wallet events for better UX
window.ethereum?.on('accountsChanged', (accounts) => {
    console.log("Accounts changed event detected:", accounts);
    if (accounts.length > 0) {
        connectWallet(); // เรียก connectWallet ใหม่เมื่อบัญชีเปลี่ยน
    } else {
        account = null;
        document.getElementById("walletAddress").innerText = `❌ ยังไม่เชื่อมต่อกระเป๋า`;
        document.getElementById("stakeAmount").innerText = "โปรดเชื่อมต่อกระเป๋า";
        document.getElementById("refLink").value = "";
    }
});

window.ethereum?.on('chainChanged', (chainId) => {
    console.log("Chain changed event detected:", chainId);
    connectWallet(); // เรียก connectWallet ใหม่เมื่อเครือข่ายเปลี่ยน
});

