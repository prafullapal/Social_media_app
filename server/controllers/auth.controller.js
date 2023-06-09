const Users = require("../models/user.model");
const Token = require("../models/token.model");
const {
  sendVerificationEmail,
  sendResetPasswordEmail,
  attachCookiesToResponse,
  createTokenUser,
  hashString,
} = require("../utils");
const crypto = require("crypto");

const register = async (req, res, next) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name || !password)
      return next({
        status: 400,
        message: "Please provide all values",
      });
    const emailAlreadyExists = await Users.findOne({ email });
    if (emailAlreadyExists) {
      return next({
        status: 400,
        message: "Email already exists",
      });
    }

    const isFirstAccount = (await Users.countDocuments({})) === 0;
    const role = isFirstAccount ? "admin" : "user";

    const verificationToken = crypto.randomBytes(40).toString("hex");

    const user = await Users.create({
      name,
      email,
      password,
      role,
      verificationToken,
    });
    const origin = req.headers.origin.toString();
    await sendVerificationEmail({
      name: user.name,
      email: user.email,
      verificationToken: user.verificationToken,
      origin,
    });
    res
      .status(200)
      .json({ msg: "Success! Please check your email to verify account" });
  } catch (err) {
    return next(err);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    const { token, email } = req.body;
    if (!token || !email)
      return next({
        status: 400,
        message: "Please provide all values",
      });
    const user = await Users.findOne({ email });

    if (!user) {
      return next({
        status: 403,
        message: "Verification Failed",
      });
    }

    if (user.verificationToken !== token) {
      return next({
        status: 403,
        message: "Verification Failed",
      });
    }

    user.isVerified = true;
    user.verified = Date.now();
    user.verificationToken = "";

    await user.save();
    res.status(200).json({ msg: "Email Verified" });
  } catch (err) {
    return next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return next({
        status: 400,
        message: "Please provide all values",
      });
    }
    const user = await Users.findOne({ email });

    if (!user) {
      return next({
        status: 403,
        message: "Invalid Credentials",
      });
    }
    const isPasswordCorrect = await user.comparePassword(password);

    if (!isPasswordCorrect) {
      return next({
        status: 403,
        message: "Invalid Credentials",
      });
    }

    if (!user.isVerified) {
      return next({
        status: 403,
        message: "Please verify email",
      });
    }
    const tokenUser = createTokenUser(user);

    let refreshToken = "";
    const existingToken = await Token.findOne({ user: user._id });

    if (existingToken) {
      const { isValid } = existingToken;
      if (!isValid) {
        return next({
          status: 403,
          message: "Invalid Credentials",
        });
      }
      refreshToken = existingToken.refreshToken;
      attachCookiesToResponse({ res, user: tokenUser, refreshToken });
      res.status(200).json({ user: tokenUser });
      return;
    }

    refreshToken = crypto.randomBytes(40).toString("hex");
    const userAgent = req.headers["user-agent"];
    const ip = req.ip;
    const userToken = { refreshToken, ip, userAgent, user: user._id };

    await Token.create(userToken);

    attachCookiesToResponse({ res, user: tokenUser, refreshToken });

    res.status(200).json({ user: tokenUser });
  } catch (err) {
    return next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    await Token.findOneAndDelete({ user: req.user.userId });

    res.cookie("accessToken", "logout", {
      httpOnly: true,
      expires: new Date(Date.now()),
    });
    res.cookie("refreshToken", "logout", {
      httpOnly: true,
      expires: new Date(Date.now()),
    });
    res.status(200).json({ msg: "Success! User Logged Out." });
  } catch (err) {
    return next(err);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return next({
        status: 400,
        message: "Please provide valid email",
      });
    }
    const user = await Users.findOne({ email });

    if (user) {
      const passwordToken = crypto.randomBytes(70).toString("hex");

      const origin = req.headers.host.toString();
      await sendResetPasswordEmail({
        name: user.name,
        email: user.email,
        token: passwordToken,
        origin,
      });

      const tenMinutes = 1000 * 60 * 100;
      const passwordTokenExpirationDate = new Date(Date.now() + tenMinutes);

      user.passwordToken = hashString(passwordToken);
      user.passwordTokenExpirationDate = passwordTokenExpirationDate;
      await user.save();
    }

    res
      .status(200)
      .json({ msg: "Please check your email for reset password link" });
  } catch (err) {
    return next(err);
  }
};
const resetPassword = async (req, res, next) => {
  try {
    const { token, email } = req.query;
    const { password } = req.body;
    if (!token || !email || !password) {
      return next({
        status: 400,
        message: "Please provide all values",
      });
    }
    const user = await Users.findOne({ email });

    if (user) {
      if (user.passwordToken !== token) {
        return next({
          status: 400,
          message: "Could not update Password",
        });
      }
      user.password = password;
      user.passwordToken = null;
      user.passwordTokenExpirationDate = null;
      await user.save();
    }

    res.status(200).json({ msg: "Success! Password has been reset." });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  register,
  login,
  logout,
  verifyEmail,
  forgotPassword,
  resetPassword,
};
