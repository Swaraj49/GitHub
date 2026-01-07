import { Router } from "express";

export const vehicleLoanRouter = Router();

// --- Helper Utilities ---
const calculateEMI = (P, annualRate, tenureYears) => {
    const r = annualRate / 12 / 100;
    const n = tenureYears * 12;
    if (r === 0) return P / n;
    const emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    return Math.round(emi);
};

const calculateMaxLoanFromEMI = (maxEMI, annualRate, tenureYears) => {
    const r = annualRate / 12 / 100;
    const n = tenureYears * 12;
    const principal = maxEMI * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));
    return Math.round(principal);
};

// --- Main Eligibility Endpoint ---
vehicleLoanRouter.post("/check-vehicle-eligibility", async (req, res) => {
    try {
        const {
            vehicleDetails,   // { type: 'New'|'Used', price: 1000000 }
            applicantDetails, // { age, income, existingEMIs, creditScore, downpayment }
            loanRequest       // { preferredTenureYears }
        } = req.body;

        const rejectionReasons = [];

        // 1. Hard Rejection Rules
        if (applicantDetails.age < 21 || applicantDetails.age > 60) {
            rejectionReasons.push("Age must be between 21 and 60 years.");
        }
        if (applicantDetails.creditScore < 650) {
            rejectionReasons.push("Credit score too low for vehicle financing.");
        }

        // Calculate the actual loan needed after downpayment
        const loanNeededAfterDownpayment = vehicleDetails.price - applicantDetails.downpayment;

        if (loanNeededAfterDownpayment <= 0) {
            rejectionReasons.push("Downpayment exceeds or equals vehicle price.");
        }

        if (rejectionReasons.length > 0) {
            return res.json({ status: "Rejected", reasons: rejectionReasons });
        }

        // 2. Interest Rate Assignment
        let interestRate = vehicleDetails.type === "New" ? 8.5 : 12.5;
        if (applicantDetails.creditScore >= 800) interestRate -= 0.5;

        // 3. LTV (Loan to Value) Rule
        // Banks usually mandate a MINIMUM downpayment (e.g., 10% for new cars)
        const maxLTVRatio = vehicleDetails.type === "New" ? 0.90 : 0.75;
        const ltvCap = vehicleDetails.price * maxLTVRatio;
        const minDownpaymentRequired = vehicleDetails.price * (1 - maxLTVRatio);

        if (applicantDetails.downpayment < minDownpaymentRequired) {
            rejectionReasons.push(`Minimum downpayment for this vehicle is ₹${minDownpaymentRequired}`);
            return res.json({ status: "Rejected", reasons: rejectionReasons });
        }

        // 4. Repayment Capacity (EMI Limit)
        const availableEMICapacity = (applicantDetails.income * 0.50) - applicantDetails.existingEMIs;
        const tenure = Math.min(loanRequest.preferredTenureYears, 7);
        const incomeBasedMaxLoan = calculateMaxLoanFromEMI(availableEMICapacity, interestRate, tenure);

        // 5. Final Decision Logic
        // The approved amount is the lowest of: (Requested Loan) OR (LTV Cap) OR (Income Cap)
        let approvedAmount = Math.min(
            loanNeededAfterDownpayment,
            ltvCap,
            incomeBasedMaxLoan
        );

        const finalEMI = calculateEMI(approvedAmount, interestRate, tenure);
        
        

        res.json({
            eligibilityStatus: approvedAmount >= loanNeededAfterDownpayment ? "Approved" : "Partially Approved",
            vehiclePrice: vehicleDetails.price,
            userDownpayment: applicantDetails.downpayment,
            approvedLoanAmount: Math.round(approvedAmount),
            interestRate: interestRate.toFixed(2),
            monthlyEMI: finalEMI,
            tenureYears: tenure,
            totalInterestPayable: Math.round((finalEMI * tenure * 12) - approvedAmount),
            remarks: approvedAmount < loanNeededAfterDownpayment 
                ? "Eligible for a lower amount than requested based on income/LTV." 
                : "Full loan approved."
        });

    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});