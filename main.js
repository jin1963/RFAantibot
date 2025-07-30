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

// ABI สำหรับ PancakeSwap Router V2 (minimal, สำหรับ getAmountsOut)
// เนื่องจาก Router ABI ไม่ได้อยู่ใน config.js ของคุณ จึงยังคงประกาศไว้ที่นี่
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

// Minimal ABI สำหรับ ERC20 tokens (สำหรับ decimals, approve, allowance)
// ใช้สำหรับ KJC และเป็น fallback สำหรับ USDT ถ้า usdtABI ใน config.js ไม่ครอบคลุมฟังก์ชันที่จำเป็น
const ERC20_ABI_MINIMAL = [
  {"constant": true, "inputs": [], "name": "decimals", "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}], "payable": false, "stateMutability": "view", "type": "function"},
  {"constant": false, "inputs": [{"internalType": "address", "name": "spender", "type":"address"},{"internalType": "uint256", "name": "amount", "type":"uint256"}], "name": "approve", "outputs": [{"internalType": "bool", "name": "", "type":"bool"}], "payable": false, "stateMutability": "nonpayable", "type":"function"},
  {"constant": true, "inputs": [{"internalType": "address", "name": "owner", "type":"address"},{"internalType": "address", "name": "spender", "type":"address"}], "name": "allowance", "outputs": [{"internalType": "uint256", "name": "", "type":"uint256"}], "payable": false, "stateMutability": "view", "type":"function"}
];

// Chain ID สำหรับ Binance Smart Chain Mainnet
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
        if (BigInt(weiAmount) === BigInt(0)) return '0'; 
        
        let amountStr = BigInt(weiAmount).toString();
        
        if (amountStr.length <= decimals) {
            amountStr = '0.' + '0'.repeat(decimals - amountStr.length) + amountStr;
        } else {
            amountStr = amountStr.slice(0, amountStr.length - decimals) + '.' + amountStr.slice(amountStr.length - decimals);
        }
        return amountStr.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');

    } catch (e) {
        console.error("Error converting Wei to Token display:", e);
        return (parseFloat(weiAmount.toString()) / (10 ** decimals)).toString(); 
    }
}

// Converts human-readable token amount to Wei based on decimals
function tokenToWei(tokenAmount, decimals) {
    if (!web3 || !tokenAmount || typeof decimals === 'undefined' || isNaN(decimals)) return '0';
    try {
        // web3.utils.toWei ต้องการ string สำหรับ amount และ 'ether'/'gwei'/'mwei' หรือจำนวนทศนิยม
        // เนื่องจาก decimals เราดึงมาแบบ dynamic จึงใช้ BigNumber.js logic ที่แม่นยำกว่า
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
        // Fallback, อาจจะไม่แม่นยำถ้าไม่ใช้ 18 ทศนิยมเสมอไป
        return web3.utils.toWei(tokenAmount.toString(), 'ether'); 
    }
}


// --- Main DApp Functions ---

async function connectWallet() {
  if (window.ethereum) {
    web3 = new Web3(window.ethereum);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      account = accounts[0];
      console.log("Connected account:", account);

      const currentChainId = await web3.eth.getChainId();
      const currentChainIdHex = web3.utils.toHex(currentChainId);

      if (currentChainIdHex !== BSC_CHAIN_ID) {
        console.warn(`Wrong network. Current: ${currentChainIdHex}, Expected: ${BSC_CHAIN_ID}. Attempting to switch.`);
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BSC_CHAIN_ID }],
          });
          const newAccounts = await web3.eth.getAccounts();
          account = newAccounts[0];
          console.log("Switched to BSC. Connected account:", account);

        } catch (switchError) {
          if (switchError.code === 4902) {
            console.log("BSC network not found in wallet. Attempting to add it.");
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
              const newAccounts = await web3.eth.getAccounts();
              account = newAccounts[0];
              console.log("BSC network added. Connected account:", account);

            } catch (addError) {
              console.error("Error adding BSC network:", addError);
              alert("❌ กรุณาเพิ่ม Binance Smart Chain ในกระเป๋าของคุณด้วยตนเอง");
              document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`;
              return;
            }
          } else {
            console.error("Error switching network:", switchError);
            alert("❌ กรุณาสลับไป Binance Smart Chain ด้วยตนเอง");
            document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`;
            return;
          }
        }
      }

      document.getElementById("walletAddress").innerText = `✅ ${account}`;

      // --- Initializing Contracts ---
      // **ใช้ชื่อตัวแปร Address และ ABI จาก config.js ของคุณโดยตรง**
      // ตรวจสอบให้แน่ใจว่าตัวแปรเหล่านี้ถูกประกาศใน config.js และมีค่าถูกต้อง
      if (!contractAddress || !stakingABI || !usdtAddress || !usdtABI || !kjcAddress || !routerAddress) {
          console.error("Critical: One or more contract addresses/ABIs from config.js are undefined. Please check config.js file.");
          alert("❌ การตั้งค่า Contract ไม่สมบูรณ์ กรุณาตรวจสอบ config.js");
          document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`;
          return;
      }

      stakingContract = new web3.eth.Contract(stakingABI, contractAddress);
      routerContract = new web3.eth.Contract(ROUTER_ABI_MINIMAL, routerAddress);
      usdtContract = new web3.eth.Contract(usdtABI, usdtAddress); // ใช้ usdtABI จาก config.js
      kjcContract = new web3.eth.Contract(ERC20_ABI_MINIMAL, kjcAddress); // ใช้ minimal ERC20 ABI สำหรับ KJC

      usdtDecimals = await getTokenDecimals(usdtContract, 18);
      kjcDecimals = await getTokenDecimals(kjcContract, 18);
      console.log(`Initialized Contracts. USDT Decimals: ${usdtDecimals}, KJC Decimals: ${kjcDecimals}`);


      generateReferralLink();
      loadStakingInfo();
    } catch (error) {
      console.error("❌ การเชื่อมต่อกระเป๋าล้มเหลว:", error);
      const errorMessage = getFriendlyErrorMessage(error);
      alert("❌ การเชื่อมต่อกระเป๋าล้มเหลว: " + errorMessage);
      document.getElementById("walletAddress").innerText = `❌ การเชื่อมต่อล้มเหลว`;
    }
  } else {
    alert("กรุณาติดตั้ง MetaMask หรือ Bitget Wallet หรือเปิด DApp ผ่าน Browser ใน Wallet App");
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
  if (ref && web3 && web3.utils.isAddress(ref)) {
    document.getElementById("refAddress").value = ref;
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
    console.log("Register Referrer Tx Hash:", txResponse.transactionHash);
    
    alert("กำลังรอการยืนยันการสมัคร Referrer... กรุณาตรวจสอบสถานะใน Wallet ของคุณ");

    const receipt = await web3.eth.getTransactionReceipt(txResponse.transactionHash);
    
    if (receipt && receipt.status) {
        alert("✅ สมัคร Referrer สำเร็จแล้ว!"); 
        console.log("Referrer registration confirmed:", receipt);
    } else {
        alert("❌ การสมัคร Referrer ไม่สำเร็จ หรือธุรกรรมถูกปฏิเสธ");
        console.error("Referrer registration failed or not confirmed:", receipt);
    }
    
  } catch (e) {
    console.error("สมัคร Referrer ผิดพลาด:", e);
    const errorMessage = getFriendlyErrorMessage(e);
    alert(`❌ เกิดข้อผิดพลาดในการสมัคร Referrer: ${errorMessage}`);
  }
}

async function buyToken() {
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

  const usdtAmountFloat = parseFloat(rawInput);
  const usdtInWei = tokenToWei(usdtAmountFloat, usdtDecimals);
  
  console.log(`USDT Amount (User Input): ${usdtAmountFloat}`);
  console.log(`USDT Amount (in Wei, based on ${usdtDecimals} decimals): ${usdtInWei}`);

  try {
    // ตรวจสอบความถูกต้องของ Address ก่อนใช้งาน
    if (!web3.utils.isAddress(usdtAddress) || !web3.utils.isAddress(kjcAddress)) {
        alert("❌ ที่อยู่ Token ไม่ถูกต้องใน config.js");
        return;
    }

    const path = [usdtAddress, kjcAddress];

    const amountsOut = await routerContract.methods.getAmountsOut(usdtInWei, path).call();
    const expectedKjcOutWei = BigInt(amountsOut[1]);
    console.log(`Expected KJC from Router (raw Wei): ${expectedKjcOutWei.toString()}`);
    console.log(`Expected KJC from Router (formatted): ${displayWeiToToken(expectedKjcOutWei, kjcDecimals)} KJC`);

    const SLIPPAGE_PERCENTAGE = 5;
    const minOut = expectedKjcOutWei * BigInt(100 - SLIPPAGE_PERCENTAGE) / 100n;
    console.log(`Minimum KJC to receive (with ${SLIPPAGE_PERCENTAGE}% slippage): ${minOut.toString()} Wei`);
    console.log(`Minimum KJC to receive (formatted): ${displayWeiToToken(minOut, kjcDecimals)} KJC`);

    const allowance = await usdtContract.methods.allowance(account, contractAddress).call();
    console.log(`Current Allowance for Staking Contract: ${allowance.toString()} Wei`);

    if (BigInt(allowance) < BigInt(usdtInWei)) {
      console.log("Allowance insufficient. Initiating approval...");
      const approveTx = await usdtContract.methods.approve(contractAddress, usdtInWei).send({ from: account });
      console.log("Approve Transaction Hash:", approveTx.transactionHash);
      alert("✅ การอนุมัติ USDT สำเร็จแล้ว! กรุณากด 'ซื้อเหรียญ KJC' อีกครั้งเพื่อดำเนินการ Stake.");
      return; 
    } else {
      console.log("Allowance is sufficient. Proceeding with buy and stake.");
    }

    console.log("Initiating buyAndStake transaction...");
    const buyTx = await stakingContract.methods.buyAndStake(usdtInWei, minOut.toString()).send({ from: account });
    console.log("Buy and Stake Transaction Hash:", buyTx.transactionHash);

    alert(`✅ ซื้อ ${usdtAmountFloat} USDT และ Stake สำเร็จ!`);
    loadStakingInfo();
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
    
    const display = displayWeiToToken(rawAmount, kjcDecimals);

    const depositDate = new Date(Number(stakeTime) * 1000);
    const endDate = new Date((Number(stakeTime) + Number(duration)) * 1000);
    const formatDate = (d) => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

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
    console.error("เคลมล้มเหลว:", e);
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
  getReferrerFromURL();
  
  // ใช้ querySelector และ ? (Optional Chaining) เพื่อความปลอดภัย กรณี ID ไม่เจอ
  document.querySelector('button[onclick="connectWallet()"]')?
    .addEventListener('click', connectWallet);
  document.querySelector('button[onclick="copyRefLink()"]')?
    .addEventListener('click', copyRefLink);
  document.querySelector('button[onclick="registerReferrer()"]')?
    .addEventListener('click', registerReferrer);
  document.querySelector('button[onclick="buyToken()"]')?
    .addEventListener('click', buyToken);
  document.querySelector('button[onclick="claimReward()"]')?
    .addEventListener('click', claimReward);
});

// Optional: Handle Wallet events for better UX
window.ethereum?.on('accountsChanged', (accounts) => {
    console.log("Accounts changed:", accounts);
    if (accounts.length > 0) {
        connectWallet(); 
    } else {
        account = null;
        document.getElementById("walletAddress").innerText = `❌ ยังไม่เชื่อมต่อกระเป๋า`;
        document.getElementById("stakeAmount").innerText = "โปรดเชื่อมต่อกระเป๋า";
        document.getElementById("refLink").value = "";
    }
});

window.ethereum?.on('chainChanged', (chainId) => {
    console.log("Chain changed to:", chainId);
    connectWallet();
});

