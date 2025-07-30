// main.js (เฉพาะส่วนของฟังก์ชัน registerReferrer ที่เปลี่ยนแปลง)

// ... โค้ดส่วนอื่นๆ ก่อนหน้า ...

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
    // 1. ส่งธุรกรรมและรอ Transaction Hash กลับมา
    const txResponse = await stakingContract.methods.setReferrer(ref).send({ from: account });
    console.log("Register Referrer Tx Hash:", txResponse.transactionHash);
    
    // 2. แสดงข้อความชั่วคราวว่ากำลังรอการยืนยัน
    alert("กำลังรอการยืนยันการสมัคร Referrer... กรุณาตรวจสอบสถานะใน Wallet ของคุณ");

    // 3. รอให้ธุรกรรมได้รับการยืนยันบนบล็อกเชนจริงๆ
    // Note: web3.js's .send() typically waits for transaction hash. 
    // To wait for full confirmation (mined in a block), you'd need to poll or use a helper.
    // For simplicity, we'll assume the .send() wait is enough or add a short delay.
    // If you need more robust waiting, consider `web3.eth.getTransactionReceipt` polling.
    
    // วิธีที่ 1: ใช้ setTimeout (วิธีง่ายที่สุด แต่ไม่รับประกันว่า mined จริงๆ)
    // setTimeout(() => {
    //     alert("✅ สมัคร Referrer สำเร็จแล้ว!"); 
    // }, 5000); // รอ 5 วินาที

    // วิธีที่ 2: ใช้ getTransactionReceipt เพื่อรอการยืนยัน (วิธีที่แนะนำและแม่นยำกว่า)
    const receipt = await web3.eth.getTransactionReceipt(txResponse.transactionHash);
    if (receipt && receipt.status) { // Check if receipt exists and status is true (success)
        alert("✅ สมัคร Referrer สำเร็จแล้ว!"); 
        console.log("Referrer registration confirmed:", receipt);
    } else {
        // This case indicates transaction was mined but failed (reverted) or not found.
        alert("❌ การสมัคร Referrer ไม่สำเร็จ หรือธุรกรรมถูกปฏิเสธ");
        console.error("Referrer registration failed or not confirmed:", receipt);
    }
    
  } catch (e) {
    console.error("สมัคร Referrer ผิดพลาด:", e);
    const errorMessage = getFriendlyErrorMessage(e);
    alert(`❌ เกิดข้อผิดพลาดในการสมัคร Referrer: ${errorMessage}`);
  }
}

// ... โค้ดส่วนอื่นๆ ที่เหลือ (ไม่เปลี่ยนแปลง) ...
