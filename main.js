let web3;
let account;
let stakingContract;

const BSC_CHAIN_ID = '0x38';

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
              console.error("❌ ไม่สามารถเพิ่ม BSC:", addError);
              alert("❌ กรุณาเพิ่ม Binance Smart Chain ในกระเป๋าของคุณ");
              return;
            }
          } else {
            console.error("❌ ไม่สามารถสลับ BSC:", switchError);
            alert("❌ กรุณาสลับไป Binance Smart Chain");
            return;
          }
        }
      }

      const accounts = await web3.eth.getAccounts();
      account = accounts[0];
      document.getElementById("walletAddress").innerText = `✅ ${account}`;
      stakingContract = new web3.eth.Contract(stakingABI, contractAddress); 
      generateReferralLink();
      loadStakingInfo();
    } catch (error) {
      console.error("❌ การเชื่อมต่อกระเป๋าล้มเหลว:", error);
    }
  } else {
    alert("กรุณาติดตั้ง MetaMask หรือ Bitget Wallet");
  }
}

function generateReferralLink() {
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
  if (!web3.utils.isAddress(ref)) {
    alert("❌ Referrer address ไม่ถูกต้อง");
    return;
  }

  try {
    await stakingContract.methods.setReferrer(ref).send({ from: account });
    alert("✅ สมัคร Referrer สำเร็จแล้ว");
  } catch (e) {
    console.error("สมัคร Referrer ผิดพลาด:", e);
    alert("❌ เกิดข้อผิดพลาดในการสมัคร Referrer");
  }
}

async function buyToken() {
  if (!stakingContract || !account) {
    alert("กรุณาเชื่อมกระเป๋าก่อน");
    return;
  }

  const rawInput = document.getElementById("usdtAmount").value.trim();
  if (!rawInput || isNaN(rawInput) || parseFloat(rawInput) <= 0) {
    alert("❌ กรุณาใส่จำนวน USDT ที่จะใช้ซื้อให้ถูกต้อง");
    return;
  }

  const usdtAmount = parseFloat(rawInput).toFixed(6);
  const usdtInWei = web3.utils.toWei(usdtAmount.toString(), 'mwei');
  const minOut = 0;

  try {
    const usdt = new web3.eth.Contract(usdtABI, usdtAddress); 
    await usdt.methods.approve(contractAddress, usdtInWei).send({ from: account });
    await stakingContract.methods.buyAndStake(usdtInWei, minOut).send({ from: account });

    alert(`✅ ซื้อ ${usdtAmount} USDT และ Stake สำเร็จ`);
    loadStakingInfo();
  } catch (e) {
    console.error("ซื้อเหรียญผิดพลาด:", e);
    alert("❌ เกิดข้อผิดพลาดในการซื้อเหรียญ");
  }
}

async function loadStakingInfo() {
  if (!stakingContract || !account) return;
  try {
    const rawAmount = await stakingContract.methods.stakedAmount(account).call();
    const display = web3.utils.fromWei(rawAmount, 'ether');
    document.getElementById("stakeAmount").innerText = `${display} KJC`;
  } catch (e) {
    console.error("โหลดยอด Stake ผิดพลาด:", e);
    document.getElementById("stakeAmount").innerText = "❌ โหลดไม่สำเร็จ";
  }
}

async function claimReward() {
  if (!stakingContract || !account) {
    document.getElementById("claimStatus").innerText = "⚠️ กรุณาเชื่อมกระเป๋าก่อน";
    return;
  }

  try {
    const last = await stakingContract.methods.lastClaim(account).call();
    const interval = await stakingContract.methods.CLAIM_INTERVAL().call();
    const now = Math.floor(Date.now() / 1000);

    if (now >= parseInt(last) + parseInt(interval)) {
      await stakingContract.methods.claimStakingReward().send({ from: account });
      document.getElementById("claimStatus").innerText = "🎉 เคลมรางวัลสำเร็จแล้ว!";
      loadStakingInfo();
    } else {
      const wait = Math.ceil((parseInt(last) + parseInt(interval) - now) / 60);
      document.getElementById("claimStatus").innerText = `⏳ ต้องรออีก ${wait} นาที`;
    }
  } catch (e) {
    console.error("เคลมล้มเหลว:", e);
    document.getElementById("claimStatus").innerText = "❌ เกิดข้อผิดพลาดในการเคลมรางวัล";
  }
}

window.addEventListener('load', () => {
  getReferrerFromURL();
});
