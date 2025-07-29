// main.js

// ตรวจสอบว่า web3.js ถูกโหลดแล้ว
if (typeof Web3 === 'undefined') {
  alert('Web3.js library not found. Please ensure it is loaded before this script.');
}

// Global Variables
let web3;
let account;
let stakingContract;
let routerContract;
let usdtContract; // Instance for USDT token contract
let kjcContract;  // Instance for KJC token contract
let kjcDecimals;  // To store KJC token decimals
let usdtDecimals; // To store USDT token decimals

// Contract Addresses & ABIs are now loaded from config.js
// No need to redeclare them here, just use the global variables
// For example, in config.js you have:
// const contractAddress = "0xC444F117806B725E12154Fa7D0cd090Eec325B48"; // This will be used as STAKING_CONTRACT_ADDRESS
// const kjcAddress = "0xd479ae350dc24168e8db863c5413c35fb2044ecd"; // This will be used as KJC_TOKEN_ADDRESS
// const usdtAddress = "0x55d398326f99059fF775485246999027B3197955"; // This will be used as USDT_TOKEN_ADDRESS
// const routerAddress = "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // This will be used as ROUTER_ADDRESS
// const stakingABI = [...] // This will be used as STAKING_ABI
// const usdtABI = [...] // This will be used as USDT_ABI (we will define a minimal KJC ABI as well)

// ABI for PancakeSwap Router V2 (minimal)
// This is still needed here as it's not in your config.js
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

// Minimal ABI for ERC20 tokens (KJC token will use this, if you don't have its full ABI)
const ERC20_ABI_MINIMAL = [
  {"constant": true, "inputs": [], "name": "decimals", "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}], "payable": false, "stateMutability": "view", "type": "function"},
  {"constant": false, "inputs": [{"internalType": "address", "name": "spender", "type": "address"},{"internalType": "uint256", "name": "amount", "type": "uint256"}], "name": "approve", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "payable": false, "stateMutability": "nonpayable", "type": "function"},
  {"constant": true, "inputs": [{"internalType": "address", "name": "owner", "type": "address"},{"internalType": "address", "name": "spender", "type": "address"}], "name": "allowance", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "payable": false, "stateMutability": "view", "type": "function"}
];

// Chain ID (can also be in config.js if you prefer, but often kept with main logic)
const BSC_CHAIN_ID = '0x38';


// --- Helper Functions ---

async function getTokenDecimals(tokenContractInstance, fallbackDecimals = 18) {
    if (!tokenContractInstance) {
        console.warn("Token contract instance not provided. Defaulting to", fallbackDecimals, "decimals.");
        return fallbackDecimals;
    }
    try {
        const decimals = await tokenContractInstance.methods.decimals().call();
        return parseInt(decimals);
    } catch (error) {
        console.error("Failed to get token decimals from contract. Falling back to", fallbackDecimals, "decimals:", error);
        return fallbackDecimals;
    }
}

// Converts Wei amount to human-readable token amount based on decimals
function displayWeiToToken(weiAmount, decimals) {
    if (!web3 || !weiAmount || typeof decimals === 'undefined' || isNaN(decimals)) return '0';
    try {
        const divisor = BigInt(10) ** BigInt(decimals);
        if (BigInt(weiAmount) === BigInt(0)) return '0'; // Handle zero amount
        
        // For accurate display of fractional parts, especially for small numbers,
        // using BigNumber.js or a custom formatting function is ideal.
        // For simplicity, here's a common approach.
        let amountStr = BigInt(weiAmount).toString();
        
        if (amountStr.length <= decimals) {
            amountStr = '0.' + '0'.repeat(decimals - amountStr.length) + amountStr;
        } else {
            amountStr = amountStr.slice(0, amountStr.length - decimals) + '.' + amountStr.slice(amountStr.length - decimals);
        }
        // Remove trailing zeros after decimal point
        return amountStr.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');

    } catch (e) {
        console.error("Error converting Wei to Token display:", e);
        // Fallback for unexpected errors, might lose precision
        return (parseFloat(weiAmount.toString()) / (10 ** decimals)).toString(); 
    }
}

// Converts human-readable token amount to Wei based on decimals
function tokenToWei(tokenAmount, decimals) {
    if (!web3 || !tokenAmount || typeof decimals === 'undefined' || isNaN(decimals)) return '0';
    try {
        const [integer, fractional] = tokenAmount.toString().split('.');
        let weiAmount = BigInt(integer || '0') * (BigInt(10) ** BigInt(decimals));
        
        if (fractional) {
            if (fractional.length > decimals) {
                console.warn(`Input fractional part '${fractional}' has more decimals than token (${decimals}). Truncating.`);
            }
            const paddedFractional = (fractional + '0'.repeat(decimals)).slice(0, decimals);
            weiAmount += BigInt(paddedFractional);
        }
        return weiAmount.toString();
    } catch (e) {
        console.error("Error converting Token to Wei:", e);
        // Fallback, might be inaccurate if not 18 decimals
        return web3.utils.toWei(tokenAmount.toString(), 'ether'); 
    }
}


// --- Main DApp Functions ---

async function connectWallet() {
  if (window.ethereum) {
    web3 = new Web3(window.ethereum);
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });

      if (currentChainId !== BSC_CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BSC_CHAIN_ID }],
          });
        } catch (switchError) {
          if (switchError.code === 4902) {
            try {
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
            } catch (addError) {
              alert("❌ กรุณาเพิ่ม Binance Smart Chain ในกระเป๋าของคุณ");
              console.error("Error adding BSC network:", addError);
              document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`; // Update status
              return;
            }
          } else {
            alert("❌ กรุณาสลับไป Binance Smart Chain");
            console.error("Error switching network:", switchError);
            document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`; // Update status
            return;
          }
        }
      }

      const accounts = await web3.eth.getAccounts();
      account = accounts[0];
      document.getElementById("walletAddress").innerText = `✅ ${account}`;

      // Initialize contracts using ABIs and Addresses from config.js
      stakingContract = new web3.eth.Contract(stakingABI, contractAddress);
      routerContract = new web3.eth.Contract(ROUTER_ABI_MINIMAL, routerAddress);
      usdtContract = new web3.eth.Contract(usdtABI, usdtAddress); // Use usdtABI from config.js
      kjcContract = new web3.eth.Contract(ERC20_ABI_MINIMAL, kjcAddress); // Use minimal ABI for KJC, assuming full KJC ABI not provided

      // Get decimals dynamically
      usdtDecimals = await getTokenDecimals(usdtContract, 18); // Pass 18 as fallback for USDT
      kjcDecimals = await getTokenDecimals(kjcContract, 18);  // Pass 18 as fallback for KJC (as per your KJC contract)
      console.log(`Initialized. USDT Decimals: ${usdtDecimals}, KJC Decimals: ${kjcDecimals}`);


      generateReferralLink();
      loadStakingInfo();
    } catch (error) {
      console.error("❌ การเชื่อมต่อกระเป๋าล้มเหลว:", error);
      alert("❌ การเชื่อมต่อกระเป๋าล้มเหลว: " + (error.message || "Unknown error"));
      document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`;
    }
  } else {
    alert("กรุณาติดตั้ง MetaMask หรือ Bitget Wallet");
    document.getElementById("walletAddress").innerText = `❌ ไม่พบ Wallet Extension`;
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
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref');
  if (ref && web3.utils.isAddress(ref)) {
    document.getElementById("refAddress").value = ref;
  }
}

async function registerReferrer() {
  if (!stakingContract || !account) {
    alert("กรุณาเชื่อมกระเป๋าก่อน");
    return;
  }

  const ref = document.getElementById("refAddress").value;
  if (!web3.utils.isAddress(ref) || ref.toLowerCase() === account.toLowerCase()) { // Added check for self-referral
    alert("❌ Referrer address ไม่ถูกต้อง หรือเป็น Address ของคุณเอง");
    return;
  }

  try {
    const tx = await stakingContract.methods.setReferrer(ref).send({ from: account });
    console.log("Register Referrer Tx Hash:", tx.transactionHash);
    alert("✅ สมัคร Referrer สำเร็จแล้ว");
  } catch (e) {
    console.error("สมัคร Referrer ผิดพลาด:", e);
    const errorMessage = getFriendlyErrorMessage(e);
    alert(`❌ เกิดข้อผิดพลาดในการสมัคร Referrer: ${errorMessage}`);
  }
}

async function buyToken() {
  // Check if all necessary contracts and decimals are loaded
  if (!stakingContract || !account || !usdtContract || !routerContract || typeof usdtDecimals === 'undefined' || typeof kjcDecimals === 'undefined') {
    alert("⚠️ กำลังโหลดข้อมูล กรุณารอสักครู่แล้วลองใหม่");
    console.warn("Contracts or decimals not initialized yet for buyToken.");
    return;
  }

  const rawInput = document.getElementById("usdtAmount").value.trim();
  if (!rawInput || isNaN(rawInput) || parseFloat(rawInput) <= 0) {
    alert("❌ กรุณาใส่จำนวน USDT ที่จะใช้ซื้อให้ถูกต้อง (ต้องมากกว่า 0)");
    return;
  }

  const usdtAmountFloat = parseFloat(rawInput); // User input as float
  const usdtInWei = tokenToWei(usdtAmountFloat, usdtDecimals); // Convert to Wei using dynamic decimals
  
  console.log(`USDT Amount (User Input): ${usdtAmountFloat}`);
  console.log(`USDT Amount (in Wei, based on ${usdtDecimals} decimals): ${usdtInWei}`);

  try {
    const path = [usdtAddress, kjcAddress]; // Use global usdtAddress, kjcAddress from config.js

    // Get expected KJC output from router
    const amountsOut = await routerContract.methods.getAmountsOut(usdtInWei, path).call();
    const expectedKjcOutWei = BigInt(amountsOut[1]);
    console.log(`Expected KJC from Router (raw Wei): ${expectedKjcOutWei.toString()}`);
    console.log(`Expected KJC from Router (formatted): ${displayWeiToToken(expectedKjcOutWei, kjcDecimals)} KJC`);

    // Calculate minOut with desired slippage (e.g., 5%)
    const SLIPPAGE_PERCENTAGE = 5; // Recommended to be 0.5-5.0 for stability. Adjust as needed.
    const minOut = expectedKjcOutWei * BigInt(100 - SLIPPAGE_PERCENTAGE) / 100n;
    console.log(`Minimum KJC to receive (with ${SLIPPAGE_PERCENTAGE}% slippage): ${minOut.toString()} Wei`);
    console.log(`Minimum KJC to receive (formatted): ${displayWeiToToken(minOut, kjcDecimals)} KJC`);

    // Check current allowance
    const allowance = await usdtContract.methods.allowance(account, contractAddress).call(); // Use global contractAddress from config.js
    console.log(`Current Allowance for Staking Contract: ${allowance.toString()} Wei`);

    // Approve if allowance is not sufficient
    if (BigInt(allowance) < BigInt(usdtInWei)) {
      console.log("Allowance insufficient. Initiating approval...");
      const approveTx = await usdtContract.methods.approve(contractAddress, usdtInWei).send({ from: account });
      console.log("Approve Transaction Hash:", approveTx.transactionHash);
      alert("✅ การอนุมัติ USDT สำเร็จแล้ว! กรุณากด 'ซื้อเหรียญ KJC' อีกครั้งเพื่อดำเนินการ Stake.");
      return; 
    } else {
      console.log("Allowance is sufficient. Proceeding with buy and stake.");
    }

    // Perform buy and stake
    console.log("Initiating buyAndStake transaction...");
    const buyTx = await stakingContract.methods.buyAndStake(usdtInWei, minOut.toString()).send({ from: account });
    console.log("Buy and Stake Transaction Hash:", buyTx.transactionHash);

    alert(`✅ ซื้อ ${usdtAmountFloat} USDT และ Stake สำเร็จ!`);
    loadStakingInfo(); // Refresh staking info after successful transaction
  } catch (e) {
    console.error("ซื้อเหรียญผิดพลาด:", e);
    const errorMessage = getFriendlyErrorMessage(e);
    alert(`❌ เกิดข้อผิดพลาดในการซื้อเหรียญ: ${errorMessage}`);
  }
}

async function loadStakingInfo() {
  if (!stakingContract || !account || typeof kjcDecimals === 'undefined') {
      document.getElementById("stakeAmount").innerText = "⚠️ กำลังโหลดข้อมูล...";
      return;
  }
  try {
    const rawAmount = await stakingContract.methods.stakedAmount(account).call();
    const stakeTime = await stakingContract.methods.lastStakeTime(account).call();
    const duration = await stakingContract.methods.STAKE_DURATION().call();
    
    // Convert rawAmount (Wei) to human-readable KJC amount
    const display = displayWeiToToken(rawAmount, kjcDecimals);

    const depositDate = new Date(Number(stakeTime) * 1000); // Ensure stakeTime is treated as Number for Date constructor
    const endDate = new Date((Number(stakeTime) + Number(duration)) * 1000);
    const formatDate = (d) => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });

    document.getElementById("stakeAmount").innerHTML = `
      💰 จำนวน: ${display} KJC<br/>
      📅 ฝากเมื่อ: ${formatDate(depositDate)}<br/>
      ⏳ ครบกำหนด: ${formatDate(endDate)}
    `;
    
  } catch (e) {
    console.error("โหลดยอด Stake ผิดพลาด:", e);
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
      console.log("Claim Reward Tx Hash:", tx.transactionHash);
      document.getElementById("claimStatus").innerText = "🎉 เคลมรางวัลสำเร็จแล้ว!";
      loadStakingInfo();
    } else {
      const remainingSeconds = nextClaimTime - now;
      const waitMinutes = Math.ceil(remainingSeconds / 60);
      const waitHours = Math.floor(waitMinutes / 60);
      const remainingMinutes = waitMinutes % 60;
      let waitString = "";
      if (waitHours > 0) waitString += `${waitHours} ชั่วโมง `;
      if (remainingMinutes > 0 || waitHours === 0) waitString += `${remainingMinutes} นาที`; // Ensure to show minutes if hours are 0
      document.getElementById("claimStatus").innerText = `⏳ ต้องรออีก ${waitString}`;
    }
  } catch (e) {
    console.error("เคลมล้มเหลว:", e);
    const errorMessage = getFriendlyErrorMessage(e);
    document.getElementById("claimStatus").innerText = `❌ เกิดข้อผิดพลาดในการเคลมรางวัล: ${errorMessage}`;
  }
}

// Helper to get friendly error messages from Web3.js errors
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
        }
    }
    return errorMessage;
}

// Event Listeners (Added for clarity based on your HTML structure)
window.addEventListener('load', () => {
  getReferrerFromURL();
  
  // Attach event listeners to buttons using querySelector for robustness
  document.querySelector('button[onclick="connectWallet()"]').addEventListener('click', connectWallet);
  document.querySelector('button[onclick="copyRefLink()"]').addEventListener('click', copyRefLink);
  document.querySelector('button[onclick="registerReferrer()"]').addEventListener('click', registerReferrer);
  document.querySelector('button[onclick="buyToken()"]').addEventListener('click', buyToken);
  document.querySelector('button[onclick="claimReward()"]').addEventListener('click', claimReward);
});

// Optional: Auto-load staking info if wallet is already connected (e.g., after refresh)
// This will re-initialize web3 and contracts if window.ethereum is available
window.ethereum?.on('accountsChanged', (accounts) => {
    if (accounts.length > 0) {
        // If account changes, re-run connectWallet to re-initialize everything properly
        connectWallet(); 
    } else {
        // No accounts connected, reset UI
        account = null;
        document.getElementById("walletAddress").innerText = `❌ ยังไม่เชื่อมต่อกระเป๋า`;
        document.getElementById("stakeAmount").innerText = "โปรดเชื่อมต่อกระเป๋า";
        document.getElementById("refLink").value = "";
    }
});

window.ethereum?.on('chainChanged', (chainId) => {
    // If chain changes, re-run connectWallet to check if it's BSC and re-initialize
    connectWallet();
});
