let web3;
let account;
let stakingContract;
let routerContract;

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
              alert("❌ กรุณาเพิ่ม Binance Smart Chain ในกระเป๋าของคุณ");
              return;
            }
          } else {
            alert("❌ กรุณาสลับไป Binance Smart Chain");
            return;
          }
        }
      }

      const accounts = await web3.eth.getAccounts();
      account = accounts[0];
      document.getElementById("walletAddress").innerText = `✅ ${account}`;
      stakingContract = new web3.eth.Contract(stakingABI, contractAddress);
      routerContract = new web3.eth.Contract([
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
      ], routerAddress);

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

  // **** แก้ไขตรงนี้ ****
  // เนื่องจาก USDT Address ที่ระบุมา (0x55d398326f99059fF775485246999027B3197955) มี 18 ทศนิยม
  // เราจึงต้องใช้ 'ether' ในการแปลงจากค่าที่ผู้ใช้ป้อน (ซึ่งเป็นจำนวนเต็มหรือทศนิยม)
  // ให้เป็นหน่วย Wei ที่ถูกต้องสำหรับ 18 ทศนิยม
  const usdtAmount = parseFloat(rawInput); // ไม่ต้องใช้ toFixed(6) เพราะอาจจำกัดทศนิยมของผู้ใช้
  const usdtInWei = web3.utils.toWei(usdtAmount.toString(), 'ether'); // <--- เปลี่ยนจาก 'mwei' เป็น 'ether'

  try {
    const path = [usdtAddress, kjcAddress];
    const amountsOut = await routerContract.methods.getAmountsOut(usdtInWei, path).call();
    const minOut = BigInt(amountsOut[1]) * 97n / 100n; // 3% slippage

    const usdt = new web3.eth.Contract(usdtABI, usdtAddress);
    await usdt.methods.approve(contractAddress, usdtInWei).send({ from: account });

    await stakingContract.methods.buyAndStake(usdtInWei, minOut.toString()).send({ from: account });

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
    const stakeTime = await stakingContract.methods.lastStakeTime(account).call();
    const duration = await stakingContract.methods.STAKE_DURATION().call();

    // ส่วนนี้ถูกต้องแล้ว เนื่องจาก KJC Token ของคุณมี 18 ทศนิยม
    const display = web3.utils.fromWei(rawAmount, 'ether');
    const depositDate = new Date(stakeTime * 1000);
    const endDate = new Date((parseInt(stakeTime) + parseInt(duration)) * 1000);
    const formatDate = (d) => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });

    document.getElementById("stakeAmount").innerHTML = `
      💰 จำนวน: ${display} KJC<br/>
      📅 ฝากเมื่อ: ${formatDate(depositDate)}<br/>
      ⏳ ครบกำหนด: ${formatDate(endDate)}
    `;
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
